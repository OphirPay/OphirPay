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
import {
  processWebhookRetryQueue,
  type WebhookRetryQueueSummary,
} from "@/lib/webhook-delivery-service";
import { incCronLogsPruned, incApiKeyLogsPruned } from "@/lib/metrics-counters";
import { cleanupExpiredIdempotencyKeys } from "@/lib/db/cleanup";

export const CRON_LOG_RETENTION_DAYS = 90;
export const CRON_LOG_PRUNE_BATCH_SIZE = 1000;

export const API_KEY_LOG_RETENTION_DAYS = 90;
export const API_KEY_LOG_PRUNE_BATCH_SIZE = 1000;

export interface PruneCronLogsResult {
  prunedCount: number;
  batches: number;
  cutoffDate: Date;
}

export interface PruneApiKeyRequestLogsResult {
  prunedCount: number;
  batches: number;
  cutoffDate: Date;
}

/**
 * Prunes cron execution logs older than retention window (90 days) in batches of 1,000 (issue #1420).
 *
 * Operation executes inside transactions in small batches to avoid table locking on PostgreSQL.
 * Active and failed recurring payment schedules (Recurrence, ScheduledPayment) are never deleted,
 * only ephemeral run-logs are pruned.
 */
export async function pruneCronExecutionLogs(
  options: {
    retentionDays?: number;
    batchSize?: number;
    now?: Date;
  } = {}
): Promise<PruneCronLogsResult> {
  const retentionDays = options.retentionDays ?? CRON_LOG_RETENTION_DAYS;
  const batchSize = options.batchSize ?? CRON_LOG_PRUNE_BATCH_SIZE;
  const now = options.now ?? new Date();
  const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let totalPruned = 0;
  let batches = 0;

  while (true) {
    const oldLogs = await prisma.cronExecutionLog.findMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
      select: { id: true },
      take: batchSize,
    });

    if (oldLogs.length === 0) break;

    const ids = oldLogs.map((log) => log.id);

    const deleteResult = await prisma.$transaction(async (tx) => {
      return tx.cronExecutionLog.deleteMany({
        where: {
          id: { in: ids },
        },
      });
    });

    totalPruned += deleteResult.count;
    batches += 1;
    incCronLogsPruned(deleteResult.count);

    if (oldLogs.length < batchSize) break;
  }

  logger.info("Cron execution logs pruned", {
    prunedCount: totalPruned,
    batches,
    cutoffDate: cutoffDate.toISOString(),
  });

  return {
    prunedCount: totalPruned,
    batches,
    cutoffDate,
  };
}

/**
 * Prunes API key request logs older than retention window (90 days) in batches of 1,000 (issue #1830).
 *
 * Deletions execute in bounded batches to avoid table locks and memory spikes on high-traffic databases.
 */
export async function pruneApiKeyRequestLogs(
  options: {
    retentionDays?: number;
    batchSize?: number;
    now?: Date;
  } = {}
): Promise<PruneApiKeyRequestLogsResult> {
  const retentionDays = options.retentionDays ?? API_KEY_LOG_RETENTION_DAYS;
  const batchSize = options.batchSize ?? API_KEY_LOG_PRUNE_BATCH_SIZE;
  const now = options.now ?? new Date();
  const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let totalPruned = 0;
  let batches = 0;

  while (true) {
    const oldLogs = await prisma.apiKeyRequestLog.findMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
      select: { id: true },
      take: batchSize,
    });

    if (oldLogs.length === 0) break;

    const ids = oldLogs.map((log) => log.id);

    const deleteResult = await prisma.$transaction(async (tx) => {
      return tx.apiKeyRequestLog.deleteMany({
        where: {
          id: { in: ids },
        },
      });
    });

    totalPruned += deleteResult.count;
    batches += 1;
    incApiKeyLogsPruned(deleteResult.count);

    if (oldLogs.length < batchSize) break;
  }

  logger.info("API key request logs pruned", {
    prunedCount: totalPruned,
    batches,
    cutoffDate: cutoffDate.toISOString(),
  });

  return {
    prunedCount: totalPruned,
    batches,
    cutoffDate,
  };
}

/**
 * Scheduled payment execution (issue #175).
 *
 * GitHub Actions Cron calls this endpoint every 5 minutes (see
 * `.github/workflows/scheduled-payments-cron.yml`), sending the project's
 * `CRON_SECRET` as an `x-cron-secret` header (Bearer is also accepted).
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
  /** Webhook retries drained by the same run. */
  webhookRetries: WebhookRetryQueueSummary;
  /** Number of expired cron logs pruned during this run (issue #1420). */
  prunedLogs?: number;
  /** Number of expired API key request logs pruned during this run (issue #1830). */
  prunedApiKeyLogs?: number;
  /** Number of expired idempotency keys pruned during this run (issue #2025). */
  prunedIdempotencyKeys?: number;
}

/**
 * Which queue this invocation should drain or task to execute.
 *
 * `all` (the default) keeps the existing scheduled-payment behaviour,
 * drains the webhook retry queue, records the run, and prunes expired logs.
 * `webhook-retries` allows the retry processor to be triggered on its own.
 * `cleanup` runs only the log retention pruning sweep (issue #1420).
 */
type CronTask = "all" | "webhook-retries" | "cleanup";

function resolveCronTask(request: Request): CronTask {
  const { searchParams } = new URL(request.url);
  const task = searchParams.get("task");
  if (task === "webhook-retries") return "webhook-retries";
  if (task === "cleanup") return "cleanup";
  return "all";
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

    const task = resolveCronTask(request);

    if (task === "cleanup") {
      const pruneResult = await pruneCronExecutionLogs();
      const apiKeyPruneResult = await pruneApiKeyRequestLogs();
      const idempotencyResult = await cleanupExpiredIdempotencyKeys();
      return successResponse({
        prunedCount: pruneResult.prunedCount,
        batches: pruneResult.batches,
        cutoffDate: pruneResult.cutoffDate.toISOString(),
        apiKeyLogsPruned: apiKeyPruneResult.prunedCount,
        apiKeyBatches: apiKeyPruneResult.batches,
        idempotencyKeysPruned: idempotencyResult.deletedCount,
      });
    }

    // Always drain due webhook retries first. A failing retry batch is
    // isolated inside `processWebhookRetryQueue`, so it can never block the
    // payment scheduler below.
    const webhookRetries = await processWebhookRetryQueue();

    if (task === "webhook-retries") {
      return successResponse({ webhookRetries });
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
      webhookRetries,
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

    // 1. Record execution cycle in database (issue #1420)
    try {
      await prisma.cronExecutionLog.create({
        data: {
          runId,
          task,
          picked: summary.picked,
          executed: summary.executed,
          failed: summary.failed,
          skipped: summary.skipped,
          status:
            summary.failed > 0 && summary.executed > 0
              ? "PARTIAL"
              : summary.failed > 0
              ? "FAILED"
              : "SUCCESS",
          completedAt: new Date(),
        },
      });
    } catch (logErr) {
      logger.warn("Failed to record cron execution log", { error: logErr, runId });
    }

    // 2. Prune ephemeral cron logs older than retention window (90 days) in batches of 1,000 (issue #1420)
    try {
      const pruneResult = await pruneCronExecutionLogs();
      if (pruneResult.prunedCount > 0) {
        summary.prunedLogs = pruneResult.prunedCount;
      }
    } catch (pruneErr) {
      logger.warn("Failed to prune expired cron logs", { error: pruneErr });
    }

    // 3. Prune ephemeral API key request logs older than retention window (90 days) in batches of 1,000 (issue #1830)
    try {
      const apiKeyPruneResult = await pruneApiKeyRequestLogs();
      if (apiKeyPruneResult.prunedCount > 0) {
        summary.prunedApiKeyLogs = apiKeyPruneResult.prunedCount;
      }
    } catch (pruneErr) {
      logger.warn("Failed to prune expired API key request logs", { error: pruneErr });
    }

    // 4. Prune expired idempotency keys (issue #2025)
    try {
      const idempotencyResult = await cleanupExpiredIdempotencyKeys();
      if (idempotencyResult.deletedCount > 0) {
        summary.prunedIdempotencyKeys = idempotencyResult.deletedCount;
      }
    } catch (idempotencyErr) {
      logger.warn("Failed to prune expired idempotency keys", { error: idempotencyErr });
    }

    logger.info("Scheduled payment run complete", {
      runId,
      picked: summary.picked,
      executed: summary.executed,
      failed: summary.failed,
      skipped: summary.skipped,
      prunedLogs: summary.prunedLogs,
      prunedApiKeyLogs: summary.prunedApiKeyLogs,
      prunedIdempotencyKeys: summary.prunedIdempotencyKeys,
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
