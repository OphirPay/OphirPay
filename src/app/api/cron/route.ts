// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import {
  successResponse,
  errorResponse,
  unauthorizedError,
  handleApiError,
} from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";
import { logger } from "@/lib/logger";
import { withRequestLogging } from "@/lib/request-logging";
import { verifyCsrf } from "@/lib/csrf";
import {
  MAX_EXECUTION_ATTEMPTS,
  MAX_PAYMENTS_PER_RUN,
  PROCESSING_LEASE_MS,
  authorizeCronRequest,
  candidateWhere,
  claimWhere,
  newRunId,
  selectDuePayments,
} from "@/lib/scheduler";
import { publicKeyFromSecret, submitPaymentFromSecret } from "@/lib/stellar";

/**
 * Scheduled payment execution (issue #175).
 *
 * Vercel Cron calls this endpoint on the schedule declared in `vercel.json`,
 * sending the project's `CRON_SECRET` as `Authorization: Bearer <secret>`.
 * Each run:
 *
 *   1. selects scheduled payments whose due date has passed;
 *   2. claims each one atomically (SCHEDULED → PROCESSING) — a conditional
 *      `updateMany` that exactly one of any number of overlapping runs can
 *      win, which is what makes double-execution impossible;
 *   3. signs and submits the payment from the operator account, sequentially
 *      so Stellar sequence numbers stay in step;
 *   4. records the transaction hash and the terminal status on the row.
 *
 * A failed submission returns the row to SCHEDULED for a later run until
 * `MAX_EXECUTION_ATTEMPTS` is reached, so a transient Horizon outage delays a
 * payment rather than cancelling it. A run that dies mid-flight leaves its
 * rows PROCESSING; the lease on those expires after `PROCESSING_LEASE_MS` and
 * a later run reclaims them.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Per-payment outcome reported in the run summary. */
interface ExecutionResult {
  id: string;
  status: "EXECUTED" | "FAILED" | "RETRY_SCHEDULED" | "SKIPPED";
  transactionHash?: string;
  error?: string;
}

interface RunSummary {
  runId: string;
  startedAt: string;
  /** Rows this run selected as due. */
  picked: number;
  executed: number;
  failed: number;
  /** Due rows another overlapping run had already claimed. */
  skipped: number;
  sourcePublicKey: string;
  results: ExecutionResult[];
}

async function runScheduledPayments(request: Request) {
  try {
    // GET is the Vercel Cron invocation; CSRF is enforced for POST only
    // (Bearer / x-cron-secret callers bypass inside verifyCsrf).
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;

    const auth = authorizeCronRequest(request.headers, process.env.CRON_SECRET);
    if (!auth.ok) {
      if (auth.reason === "not-configured") {
        logger.error("Cron run refused — CRON_SECRET is not configured");
        return errorResponse(
          ERROR_CODES.SERVICE_UNAVAILABLE,
          "Scheduler is not configured — CRON_SECRET is unset.",
          503
        );
      }
      return unauthorizedError("Invalid or missing cron secret.");
    }

    // Checked before any row is touched: without a signing account the run
    // could claim rows it can never submit, delaying them by a lease window.
    const sourceSecret = process.env.SCHEDULED_PAYMENTS_SOURCE_SECRET;
    if (!sourceSecret) {
      logger.error(
        "Cron run refused — SCHEDULED_PAYMENTS_SOURCE_SECRET is not configured"
      );
      return errorResponse(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Scheduler is not configured — SCHEDULED_PAYMENTS_SOURCE_SECRET is unset.",
        503
      );
    }

    let sourcePublicKey: string;
    try {
      sourcePublicKey = publicKeyFromSecret(sourceSecret);
    } catch {
      logger.error(
        "Cron run refused — SCHEDULED_PAYMENTS_SOURCE_SECRET is not a valid Stellar secret key"
      );
      return errorResponse(
        ERROR_CODES.CONFIG_ERROR,
        "Scheduler is misconfigured — SCHEDULED_PAYMENTS_SOURCE_SECRET is not a valid Stellar secret key.",
        500
      );
    }

    // One clock for the whole run: every due/lease decision below compares
    // against the same instant, so a slow run cannot pick up rows that came
    // due while it was already working.
    const now = new Date();
    const runId = newRunId();

    // The query is deliberately coarse (see `candidateWhere`); the lease and
    // attempt policy lives in `selectDuePayments`, which is pure and tested
    // against a simulated clock. Over-fetching leaves headroom for rows this
    // run must skip because another run holds a live lease on them.
    const candidates = await prisma.scheduledPayment.findMany({
      where: candidateWhere(now),
      orderBy: { scheduledAt: "asc" },
      take: MAX_PAYMENTS_PER_RUN * 2,
    });

    const due = selectDuePayments(candidates, {
      now,
      limit: MAX_PAYMENTS_PER_RUN,
      leaseMs: PROCESSING_LEASE_MS,
    });

    const summary: RunSummary = {
      runId,
      startedAt: now.toISOString(),
      picked: due.length,
      executed: 0,
      failed: 0,
      skipped: 0,
      sourcePublicKey,
      results: [],
    };

    // Sequential on purpose: every submission loads the operator account and
    // consumes its next sequence number, so concurrent submissions from the
    // same account would collide (tx_bad_seq).
    for (const payment of due) {
      const claimed = await prisma.scheduledPayment.updateMany({
        where: claimWhere(payment.id, now, PROCESSING_LEASE_MS),
        data: {
          status: "PROCESSING",
          lockedAt: now,
          lockedBy: runId,
          attempts: { increment: 1 },
        },
      });

      // Lost the race — another run owns this row. Not an error.
      if (claimed.count === 0) {
        summary.skipped += 1;
        summary.results.push({ id: payment.id, status: "SKIPPED" });
        continue;
      }

      const attempt = payment.attempts + 1;

      try {
        const result = await submitPaymentFromSecret({
          sourceSecret,
          destination: payment.destAddress,
          amount: payment.amount.toString(),
          memo: payment.memo ?? undefined,
          assetCode: payment.assetCode,
          assetIssuer: payment.assetIssuer ?? undefined,
        });

        await prisma.scheduledPayment.update({
          where: { id: payment.id },
          data: {
            status: "EXECUTED",
            transactionHash: result.hash,
            executedAt: new Date(),
            errorMessage: null,
            lockedAt: null,
            lockedBy: null,
          },
        });

        summary.executed += 1;
        summary.results.push({
          id: payment.id,
          status: "EXECUTED",
          transactionHash: result.hash,
        });
        logger.info("Scheduled payment executed", {
          id: payment.id,
          runId,
          transactionHash: result.hash,
          attempt,
        });
      } catch (err) {
        // One bad payment must not abort the run — the remaining due rows
        // are still executed, and this row is retried or given up on.
        const message = err instanceof Error ? err.message : String(err);
        const exhausted = attempt >= MAX_EXECUTION_ATTEMPTS;

        await prisma.scheduledPayment.update({
          where: { id: payment.id },
          data: {
            // Back to SCHEDULED while attempts remain, so the next run picks
            // it up immediately instead of waiting for the lease to expire.
            status: exhausted ? "FAILED" : "SCHEDULED",
            errorMessage: message,
            lockedAt: null,
            lockedBy: null,
          },
        });

        summary.failed += 1;
        summary.results.push({
          id: payment.id,
          status: exhausted ? "FAILED" : "RETRY_SCHEDULED",
          error: message,
        });
        logger.error("Scheduled payment execution failed", {
          id: payment.id,
          runId,
          attempt,
          exhausted,
          error: message,
        });
      }
    }

    logger.info("Scheduled payment run complete", {
      runId,
      picked: summary.picked,
      executed: summary.executed,
      failed: summary.failed,
      skipped: summary.skipped,
    });

    return successResponse(summary);
  } catch (err) {
    return handleApiError(err, "POST /api/cron");
  }
}

/** Vercel Cron invokes scheduled paths with GET. */
export const GET = withRequestLogging(async function GET(request: Request) {
  return runScheduledPayments(request);
});

/** Same run, for external schedulers and manual triggering. */
export const POST = withRequestLogging(async function POST(request: Request) {
  return runScheduledPayments(request);
});
