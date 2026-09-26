// SPDX-License-Identifier: MIT

/**
 * Payment reconciliation engine: supports both periodic polling and real-time
 * Horizon transaction streaming.
 *
 * A payment is "submitted" when its row transitions to SUBMITTED (a signed
 * transaction has been pushed to the network) and a `transactionHash` is
 * recorded. The Stellar ledger can close with a *failed* result even after
 * submission is accepted (e.g. insufficient balance, bad sequence, failed
 * operation), leaving the DB row stuck in SUBMITTED forever.
 *
 * This module reconciles payments in SUBMITTED state via:
 *   1. Streaming (Horizon SSE transactions stream): Real-time push updates as
 *      soon as transactions are ingested into a ledger.
 *   2. Polling (periodic cron/admin pass): Fallback backstop ensuring no
 *      transactions are left unconfirmed if the stream was temporarily down.
 *
 * Each status update is atomic (CAS pattern) and records the reconciliation
 * mechanism ("STREAM" vs "POLL") in the payment's metadata JSON.
 *
 * Each polling pass is persisted to the `PaymentSyncRun` table so results are
 * surfaced in the admin view and overlapping runs can be audited.
 */

import prisma from "@/lib/prisma";
import type { PaymentStatus } from "@prisma/client";
import { getHorizonServer } from "@/lib/stellar";
import { logger } from "@/lib/logger";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

export type SyncTrigger = "cron" | "admin" | "stream";
export type ReconciliationMechanism = "STREAM" | "POLL";

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
 * Result of an atomic payment reconciliation attempt for a single payment.
 */
export interface ReconcilePaymentResult {
  paymentId: string;
  transactionHash: string;
  status: "CONFIRMED" | "FAILED" | "SKIPPED";
  mechanism: ReconciliationMechanism;
}

/**
 * Minimal structure of a Horizon transaction stream event.
 */
export interface HorizonTransactionEvent {
  hash: string;
  successful: boolean;
  paging_token?: string;
  created_at?: string;
}

/**
 * Options for configuring the Horizon payment status stream.
 */
export interface PaymentStatusStreamOptions {
  /** Paging cursor to begin streaming from (defaults to "now"). */
  cursor?: string;
  /** Maximum backoff timeout in ms on connection error (defaults to 10000ms). */
  maxBackoffMs?: number;
  /** Initial delay in ms before first reconnection attempt (defaults to 500ms). */
  initialDelayMs?: number;
  /** Whether to run a catch-up poll sync when reconnecting (defaults to true). */
  autoReconcileOnReconnect?: boolean;
  /** Optional callback invoked when a payment is confirmed via stream. */
  onPaymentConfirmed?: (result: ReconcilePaymentResult) => void;
  /** Optional callback invoked when a payment is marked failed via stream. */
  onPaymentFailed?: (result: ReconcilePaymentResult) => void;
  /** Optional status callback for monitoring connection lifecycle. */
  onStatusChange?: (
    status: "connected" | "reconnecting" | "stopped",
    error?: unknown
  ) => void;
  /** Optional custom Horizon server instance for testing or alternative endpoints. */
  server?: {
    transactions: () => {
      cursor: (cursor: string) => {
        stream: (options: {
          onmessage?: (tx: HorizonTransactionEvent) => void;
          onerror?: (err: unknown) => void;
          reconnectTimeout?: number;
        }) => () => void;
      };
    };
  };
}

/**
 * Handle controlling an active Horizon payment status stream.
 */
export interface PaymentStatusStreamHandle {
  /** Stop listening and cancel any pending reconnection timers. */
  stop: () => void;
  /** Current pagination cursor. */
  getCursor: () => string;
  /** Current connection lifecycle state. */
  getStatus: () => "connected" | "reconnecting" | "stopped";
  /** Trigger an on-demand catch-up reconciliation for missed events. */
  reconcileMissedEvents: () => Promise<PaymentSyncRunSummary>;
}

/**
 * Options accepted by the unified `main()` entrypoint.
 */
export interface MainOptions {
  mode?: "poll" | "stream" | "both" | string;
  trigger?: SyncTrigger;
  cursor?: string;
  maxBackoffMs?: number;
  initialDelayMs?: number;
  timeoutMs?: number;
  [key: string]: unknown;
}

/**
 * Execution outcome returned by `main()`.
 */
export interface MainResult {
  status: "handled" | "started" | "completed" | "error";
  mode: string;
  boundary?: boolean;
  pollSummary?: PaymentSyncRunSummary | null;
  streamStarted?: boolean;
  error?: string | null;
}

/**
 * Human-readable error attached to a payment whose on-chain transaction
 * was included in a ledger but failed.
 */
export const ON_CHAIN_FAILED_MESSAGE =
  "Transaction failed on-chain. See the transaction on Stellar Expert for the operation result.";

/** Payments awaiting confirmation — the only status this job reconciles. */
export const AWAITING_STATUS: PaymentStatus = "SUBMITTED";

export type OnChainOutcome = "success" | "failed" | "not_found" | "error";

/**
 * Attach reconciliation mechanism and timestamp to a payment's metadata JSON.
 * Preserves any existing JSON fields or raw string data.
 */
export function attachReconciliationMetadata(
  existingMetadata: string | null | undefined,
  mechanism: ReconciliationMechanism
): string {
  let metaObj: Record<string, unknown> = {};
  if (existingMetadata) {
    try {
      const parsed = JSON.parse(existingMetadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metaObj = { ...parsed };
      } else {
        metaObj = { raw: existingMetadata };
      }
    } catch {
      metaObj = { raw: existingMetadata };
    }
  }
  metaObj.reconciledBy = mechanism;
  metaObj.reconciliationMechanism = mechanism;
  metaObj.reconciledAt = new Date().toISOString();
  return JSON.stringify(metaObj);
}

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
export async function lookupOnChainOutcome(txHash: string): Promise<OnChainOutcome> {
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
 * Atomically reconcile payment(s) associated with a given transaction hash.
 *
 * Uses a Compare-and-Swap (CAS) update conditioned on `status === "SUBMITTED"`.
 * If multiple execution paths (e.g. streaming event and cron poll) attempt to
 * transition the same payment concurrently, exactly one will update the row
 * and emit the corresponding webhook; subsequent attempts will find 0 rows
 * matching `status === "SUBMITTED"` and return `SKIPPED` without emitting
 * duplicate webhooks.
 *
 * @param txHash Stellar transaction hash.
 * @param outcome On-chain execution outcome ("success" | "failed").
 * @param mechanism Originating mechanism ("STREAM" | "POLL").
 * @param paymentId Optional payment ID to narrow transition to a single row.
 */
export async function reconcilePaymentByTxHash(
  txHash: string,
  outcome: OnChainOutcome,
  mechanism: ReconciliationMechanism = "POLL",
  paymentId?: string
): Promise<ReconcilePaymentResult[]> {
  if (!txHash || typeof txHash !== "string" || (outcome !== "success" && outcome !== "failed")) {
    return [];
  }

  const whereClause: {
    transactionHash: string;
    status: PaymentStatus;
    deletedAt: null;
    id?: string;
  } = {
    transactionHash: txHash,
    status: AWAITING_STATUS,
    deletedAt: null,
  };

  if (paymentId) {
    whereClause.id = paymentId;
  }

  const pending = await prisma.payment.findMany({
    where: whereClause,
    select: {
      id: true,
      userId: true,
      amount: true,
      assetCode: true,
      transactionHash: true,
      metadata: true,
    },
  });

  if (pending.length === 0) {
    return [];
  }

  const results: ReconcilePaymentResult[] = [];
  const now = new Date();

  for (const payment of pending) {
    const updatedMetadata = attachReconciliationMetadata(payment.metadata, mechanism);

    if (outcome === "success") {
      const updateResult = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: AWAITING_STATUS,
        },
        data: {
          status: "CONFIRMED",
          metadata: updatedMetadata,
          completedAt: now,
        },
      });

      if (updateResult.count > 0) {
        dispatchWebhookEventAsync(
          WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
          {
            paymentId: payment.id,
            amount: payment.amount,
            assetCode: payment.assetCode,
            transactionHash: txHash,
            confirmedAt: now.toISOString(),
            reconciledBy: mechanism,
          },
          payment.userId
        );
        results.push({
          paymentId: payment.id,
          transactionHash: txHash,
          status: "CONFIRMED",
          mechanism,
        });
      } else {
        results.push({
          paymentId: payment.id,
          transactionHash: txHash,
          status: "SKIPPED",
          mechanism,
        });
      }
    } else {
      const updateResult = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: AWAITING_STATUS,
        },
        data: {
          status: "FAILED",
          errorMessage: ON_CHAIN_FAILED_MESSAGE,
          metadata: updatedMetadata,
        },
      });

      if (updateResult.count > 0) {
        dispatchWebhookEventAsync(
          WEBHOOK_EVENTS.PAYMENT_FAILED,
          {
            paymentId: payment.id,
            amount: payment.amount,
            assetCode: payment.assetCode,
            transactionHash: txHash,
            errorMessage: ON_CHAIN_FAILED_MESSAGE,
            failedAt: now.toISOString(),
            reconciledBy: mechanism,
          },
          payment.userId
        );
        results.push({
          paymentId: payment.id,
          transactionHash: txHash,
          status: "FAILED",
          mechanism,
        });
      } else {
        results.push({
          paymentId: payment.id,
          transactionHash: txHash,
          status: "SKIPPED",
          mechanism,
        });
      }
    }
  }

  return results;
}

/**
 * Process a transaction received from the Horizon streaming connection.
 * Returns any payment reconciliations triggered by the event.
 */
export async function handleTransactionStreamEvent(
  tx: HorizonTransactionEvent
): Promise<ReconcilePaymentResult[]> {
  if (!tx || typeof tx !== "object" || typeof tx.hash !== "string") {
    return [];
  }

  const outcome: OnChainOutcome = tx.successful ? "success" : "failed";
  return reconcilePaymentByTxHash(tx.hash, outcome, "STREAM");
}

/**
 * Start listening to Horizon transaction stream for real-time payment reconciliation.
 *
 * Implements exponential backoff reconnection and triggers backfill sync
 * on reconnect to ensure missed events during downtime are reconciled.
 */
export function startPaymentStatusStream(
  options?: PaymentStatusStreamOptions
): PaymentStatusStreamHandle {
  let currentCursor = options?.cursor ?? "now";
  const maxBackoff = options?.maxBackoffMs ?? 10_000;
  const initialDelay = options?.initialDelayMs ?? 500;
  const autoReconcile = options?.autoReconcileOnReconnect ?? true;
  const server = options?.server ?? getHorizonServer();

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentClose: (() => void) | null = null;
  let status: "connected" | "reconnecting" | "stopped" = "connected";
  let attempt = 0;
  let stopped = false;

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    if (stopped) return;

    try {
      const streamClose = server
        .transactions()
        .cursor(currentCursor)
        .stream({
          onmessage: async (tx: HorizonTransactionEvent) => {
            if (stopped) return;
            attempt = 0; // Reset backoff upon healthy message
            if (status !== "connected") {
              status = "connected";
              options?.onStatusChange?.("connected");
            }
            if (tx && typeof tx === "object" && typeof tx.paging_token === "string") {
              currentCursor = tx.paging_token;
            }

            try {
              const results = await handleTransactionStreamEvent(tx);
              for (const r of results) {
                if (r.status === "CONFIRMED") {
                  options?.onPaymentConfirmed?.(r);
                } else if (r.status === "FAILED") {
                  options?.onPaymentFailed?.(r);
                }
              }
            } catch (err) {
              logger.warn("payment-sync: error handling stream event", {
                hash: tx?.hash,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          },
          onerror: (err: unknown) => {
            if (stopped) return;
            status = "reconnecting";
            options?.onStatusChange?.("reconnecting", err);

            if (currentClose) {
              try {
                currentClose();
              } catch {
                // ignore close error
              }
              currentClose = null;
            }

            clearTimers();
            const delay = Math.min(maxBackoff, initialDelay * Math.pow(2, attempt));
            attempt += 1;

            logger.info("payment-sync: stream error, scheduling reconnect", {
              attempt,
              delayMs: delay,
            });

            reconnectTimer = setTimeout(async () => {
              if (stopped) return;
              if (autoReconcile) {
                await runPaymentStatusSync("cron").catch((e) => {
                  logger.warn("payment-sync: backfill sync on reconnect failed", {
                    error: e instanceof Error ? e.message : String(e),
                  });
                });
              }
              if (!stopped) {
                connect();
              }
            }, delay);
          },
        });

      currentClose = streamClose;
      status = "connected";
      options?.onStatusChange?.("connected");
    } catch (err) {
      if (stopped) return;
      status = "reconnecting";
      options?.onStatusChange?.("reconnecting", err);
      clearTimers();
      const delay = Math.min(maxBackoff, initialDelay * Math.pow(2, attempt));
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    }
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      status = "stopped";
      clearTimers();
      if (currentClose) {
        try {
          currentClose();
        } catch {
          // ignore
        }
        currentClose = null;
      }
      options?.onStatusChange?.("stopped");
    },
    getCursor: () => currentCursor,
    getStatus: () => status,
    reconcileMissedEvents: () => runPaymentStatusSync("cron"),
  };
}

/**
 * Run one reconciliation pass over SUBMITTED payments.
 * Serves as the fallback safety net for missed events.
 *
 * @param trigger How this run was started — "cron" (scheduled), "admin" (on demand),
 *   or "stream" (backfill on stream reconnection).
 * @returns The persisted run summary.
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
  let scanned = 0;

  try {
    const pending = await prisma.payment.findMany({
      where: {
        status: AWAITING_STATUS,
        transactionHash: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
        amount: true,
        assetCode: true,
        transactionHash: true,
        metadata: true,
      },
    });

    scanned = pending.length;

    logger.info("payment-sync: started", {
      trigger,
      runId: run.id,
      pending: pending.length,
    });

    const processedPaymentIds = new Set<string>();

    for (const payment of pending) {
      if (processedPaymentIds.has(payment.id)) {
        continue;
      }

      const txHash = payment.transactionHash!;
      const outcome = await lookupOnChainOutcome(txHash);

      if (outcome === "success" || outcome === "failed") {
        const reconciledList = await reconcilePaymentByTxHash(
          txHash,
          outcome,
          "POLL",
          payment.id
        );
        for (const item of reconciledList) {
          if (!processedPaymentIds.has(item.paymentId)) {
            processedPaymentIds.add(item.paymentId);
            if (item.status === "CONFIRMED") counters.confirmed += 1;
            else if (item.status === "FAILED") counters.failed += 1;
          }
        }
      } else if (outcome === "not_found") {
        counters.notFound += 1;
        processedPaymentIds.add(payment.id);
      } else {
        counters.errors += 1;
        processedPaymentIds.add(payment.id);
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

/**
 * Unified service entrypoint with defensive parameter boundary handling.
 *
 * Handles null, empty, and boundary inputs gracefully without raising uncaught exceptions.
 * Supports operating modes: "poll" (default), "stream", and "both".
 */
export async function main(args?: unknown): Promise<MainResult> {
  try {
    if (args === null || args === undefined || typeof args !== "object") {
      return {
        status: "handled",
        mode: "poll",
        boundary: true,
        pollSummary: null,
        error: null,
      };
    }

    const opts = (args ?? {}) as MainOptions;
    const mode = typeof opts.mode === "string" ? opts.mode.toLowerCase() : "poll";
    const trigger: SyncTrigger =
      opts.trigger === "admin" || opts.trigger === "cron" || opts.trigger === "stream"
        ? opts.trigger
        : "cron";

    if (mode === "stream") {
      const handle = startPaymentStatusStream({
        cursor: typeof opts.cursor === "string" ? opts.cursor : "now",
        maxBackoffMs: typeof opts.maxBackoffMs === "number" ? opts.maxBackoffMs : undefined,
        initialDelayMs: typeof opts.initialDelayMs === "number" ? opts.initialDelayMs : undefined,
      });

      if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
        setTimeout(() => handle.stop(), opts.timeoutMs);
      }

      return {
        status: "started",
        mode: "stream",
        streamStarted: true,
        error: null,
      };
    }

    if (mode === "both") {
      startPaymentStatusStream({
        cursor: typeof opts.cursor === "string" ? opts.cursor : "now",
      });
      const summary = await runPaymentStatusSync(trigger);
      return {
        status: "completed",
        mode: "both",
        pollSummary: summary,
        streamStarted: true,
        error: null,
      };
    }

    // Default: "poll"
    const summary = await runPaymentStatusSync(trigger);
    return {
      status: "completed",
      mode: "poll",
      pollSummary: summary,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("payment-sync: main encountered unhandled error", { error: errorMsg });
    return {
      status: "error",
      mode: "unknown",
      error: errorMsg,
    };
  }
}

if (typeof process !== "undefined" && process.argv && process.argv[1]?.includes("payment-sync")) {
  main().catch((err) => {
    logger.error("payment-sync: CLI execution failed", { error: err });
  });
}