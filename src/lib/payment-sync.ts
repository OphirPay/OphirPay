// SPDX-License-Identifier: MIT

/**
 * Periodic job that reconciles submitted payments against their on-chain
 * outcome on Horizon.
 *
 * A payment is "submitted" when its row transitions to SUBMITTED (a signed
 * transaction has been pushed to the network) and a `transactionHash` is
 * recorded. The Stellar ledger can close with a *failed* result even after
 * submission is accepted (e.g. insufficient balance, bad sequence, failed
 * operation), leaving the DB row stuck in SUBMITTED forever.
 *
 * This module reads every payment that is STILL in SUBMITTED state (i.e. not
 * yet resolved to CONFIRMED / FAILED) and, for those that carry a tx hash,
 * queries Horizon for the on-chain outcome:
 *
 *   • succeeded                 → payment marked CONFIRMED
 *   • failed                    → payment marked FAILED (with an error message)
 *   • not yet ingested (404)    → payment left untouched (retried next run)
 *   • Horizon lookup error      → payment left untouched
 *
 * It NEVER touches payments in any other status (unsigned, confirmed,
 * completed, cancelled, …) — the acceptance criterion that the job only
 * touches transactions in pending (so far unresolved) state.
 *
 * Each run is persisted to the `PaymentSyncRun` table so results are
 * surfaced in the admin view and overlapping runs can be prevented.
 */

import prisma from "@/lib/prisma";
import { getHorizonServer } from "@/lib/stellar";
import { logger } from "@/lib/logger";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

export type SyncTrigger = "cron" | "admin";

/**
 * Aggregate summary of a single sync run, as persisted to `PaymentSyncRun`.
 */
export interface PaymentSyncRunSummary {
  id: string;
  trigger: SyncTrigger;
  status: "running" | "success" | "error";
  scanned: number;
  confirmed: number;
  failed: number;
  notFound: number;
  errors: number;
  errorMessage?: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Human-readable error attached to a payment whose on-chain transaction
 * was included in a ledger but failed.
 */
export const ON_CHAIN_FAILED_MESSAGE =
  "Transaction failed on-chain. See the transaction on Stellar Expert for the operation result.";

/** Payments awaiting confirmation — the only status this job reconciles. */
const AWAITING_STATUS = "SUBMITTED";

type OnChainOutcome = "success" | "failed" | "not_found" | "error";

/** True when `err` is a Horizon 404 (transaction not ingested yet). */
function isHorizonNotFound(err: unknown): boolean {
  const e = err as {
    response?: { status?: number };
    status?: number;
    name?: string;
    message?: string;
  };
  if (e?.response?.status === 404 || e?.status === 404) return true;
  if (e?.name === "NotFoundError") return true;
  if (typeof e?.message === "string" && /not found|404/i.test(e.message)) {
    return true;
  }
  return false;
}

/**
 * Look up the on-chain outcome of a transaction hash from Horizon.
 * Never throws — the failure is folded into the `error` outcome so the
 * reconciliation loop keeps going and the run still completes.
 */
async function lookupOnChainOutcome(txHash: string): Promise<OnChainOutcome> {
  try {
    const htx = await getHorizonServer()
      .transactions()
      .transaction(txHash)
      .call();
    return htx.successful ? "success" : "failed";
  } catch (err) {
    if (isHorizonNotFound(err)) return "not_found";
    logger.warn("payment-sync: Horizon lookup failed", {
      txHash,
      error: err instanceof Error ? err.message : String(err),
    });
    return "error";
  }
}

/**
 * Run one reconciliation pass over SUBMITTED payments.
 *
 * @param trigger How this run was started — "cron" (scheduled) or
 *   "admin" (on demand). Recorded on the run row for visibility.
 * @returns The persisted run summary (already written by the time it resolves).
 */
export async function runPaymentStatusSync(
  trigger: SyncTrigger = "cron"
): Promise<PaymentSyncRunSummary> {
  const run = await prisma.paymentSyncRun.create({
    data: {
      trigger,
      status: "running",
      scanned: 0,
      confirmed: 0,
      failed: 0,
      notFound: 0,
      errors: 0,
    },
  });

  const counters = { confirmed: 0, failed: 0, notFound: 0, errors: 0 };
  // Payments scanned during this run — initialized to 0 so the error path
  // below can report accurately even when the query itself fails.
  let scanned = 0;

  try {
    // Only SUBMITTED payments that carry a tx hash — submissions that still
    // await confirmation. Nothing in any other state is ever read or written.
    const pending = await prisma.payment.findMany({
      where: {
        status: AWAITING_STATUS,
        // Effectively `IS NOT NULL`, and paired with the SUBMITTED filter
        // guarantees every scanned row can actually be looked up on-chain.
        transactionHash: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
        amount: true,
        assetCode: true,
        transactionHash: true,
      },
    });
    scanned = pending.length;

    logger.info("payment-sync: started", {
      trigger,
      runId: run.id,
      pending: pending.length,
    });

    // Reconcile sequentially to keep the load on Horizon bounded.
    for (const payment of pending) {
      const txHash = payment.transactionHash!;
      const outcome = await lookupOnChainOutcome(txHash);

      if (outcome === "success") {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "CONFIRMED" },
        });
        dispatchWebhookEventAsync(
          WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
          {
            paymentId: payment.id,
            amount: payment.amount,
            assetCode: payment.assetCode,
            transactionHash: txHash,
            confirmedAt: new Date().toISOString(),
          },
          payment.userId
        );
        counters.confirmed += 1;
      } else if (outcome === "failed") {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", errorMessage: ON_CHAIN_FAILED_MESSAGE },
        });
        dispatchWebhookEventAsync(
          WEBHOOK_EVENTS.PAYMENT_FAILED,
          {
            paymentId: payment.id,
            amount: payment.amount,
            assetCode: payment.assetCode,
            transactionHash: txHash,
            errorMessage: ON_CHAIN_FAILED_MESSAGE,
            failedAt: new Date().toISOString(),
          },
          payment.userId
        );
        counters.failed += 1;
      } else if (outcome === "not_found") {
        // Not ingested yet — leave untouched, retried on the next run.
        counters.notFound += 1;
      } else {
        counters.errors += 1;
      }
    }

    const summary: PaymentSyncRunSummary = {
      id: run.id,
      trigger,
      status: "success",
      scanned: pending.length,
      ...counters,
      errorMessage: null,
      createdAt: run.createdAt,
      completedAt: new Date(),
    };

    await prisma.paymentSyncRun.update({
      where: { id: run.id },
      data: {
        status: summary.status,
        scanned: summary.scanned,
        confirmed: summary.confirmed,
        failed: summary.failed,
        notFound: summary.notFound,
        errors: summary.errors,
        completedAt: summary.completedAt,
      },
    });

    logger.info("payment-sync: completed", {
      trigger,
      runId: run.id,
      scanned: summary.scanned,
      ...counters,
    });

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const completedAt = new Date();

    // Best-effort: surface the failure on the run row for the admin view even
    // if writing the summary fails afterwards.
    await prisma.paymentSyncRun
      .update({
        where: { id: run.id },
        data: { status: "error", errorMessage: message, completedAt },
      })
      .catch(() => {});

    logger.error("payment-sync: failed", { trigger, runId: run.id, error: message });

    return {
      id: run.id,
      trigger,
      status: "error",
      scanned,
      confirmed: counters.confirmed,
      failed: counters.failed,
      notFound: counters.notFound,
      errors: counters.errors,
      errorMessage: message,
      createdAt: run.createdAt,
      completedAt,
    } as PaymentSyncRunSummary;
  }
}