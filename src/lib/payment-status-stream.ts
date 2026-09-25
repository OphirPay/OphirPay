// SPDX-License-Identifier: MIT

/**
 * Horizon transaction streaming for real-time payment status reconciliation.
 *
 * Subscribes to Horizon Server-Sent Events (SSE) transaction streams for
 * accounts with pending payments in SUBMITTED state. When a transaction is
 * included in a ledger, the stream handler updates payment status to CONFIRMED
 * or FAILED immediately without waiting for the periodic polling interval.
 *
 * Deduplication & Safety:
 *   - Updates use conditional atomic CAS (`where: { id, status: "SUBMITTED" }`).
 *     A stream event and a polling job observing the same transaction cannot
 *     produce duplicate transitions or duplicate webhooks.
 *   - Every status transition records `reconciliationSource` ("stream" or "poll")
 *     so the performance and coverage of both paths can be measured.
 *
 * Resilience:
 *   - Dropped connections reconnect with exponential backoff.
 *   - Reconnects resume from the last known Horizon paging token and execute
 *     a catch-up reconciliation pass to ensure no events are missed during downtime.
 *   - The existing polling job (`src/lib/payment-sync.ts`) remains active as a backstop.
 */

import prisma from "@/lib/prisma";
import { getHorizonServer } from "@/lib/stellar";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { logger } from "@/lib/logger";
import { ON_CHAIN_FAILED_MESSAGE } from "@/lib/payment-sync";

export type PaymentStreamOutcome = "success" | "failed";

export interface PaymentStatusStreamController {
  /** Stop all active streams and clear pending reconnect/refresh timers. */
  stop: () => void;
  /** Immediately register and stream an account with pending payments. */
  addAccount: (accountId: string) => void;
  /** List all currently connected account public keys. */
  getConnectedAccounts: () => string[];
  /** Check if the controller has been stopped. */
  isStopped: () => boolean;
}

export interface PaymentStatusStreamOptions {
  /** Initial backoff delay on disconnect (default: 500ms). */
  reconnectBaseMs?: number;
  /** Maximum backoff delay cap on repeated disconnects (default: 30,000ms). */
  reconnectMaxMs?: number;
  /** Polling interval to discover accounts with newly submitted payments (default: 30,000ms). */
  refreshIntervalMs?: number;
  /** Initial cursor / paging token for new streams (default: "now"). */
  initialCursor?: string;
  /** Injectable Horizon server for testing and custom network environments. */
  server?: ReturnType<typeof getHorizonServer>;
  /** Optional initial accounts to track. */
  initialAccounts?: string[];
}

export interface HorizonStreamTransaction {
  hash?: string;
  successful?: boolean;
  paging_token?: string;
}

export type StreamHandle = (() => void) | { close?: () => void };

/**
 * Transition a payment based on an on-chain stream event outcome.
 *
 * Conditionally updates from SUBMITTED to terminal state (CONFIRMED or FAILED).
 * Returns true if this invocation performed the transition, or false if
 * the payment was already transitioned (e.g. by polling, another event, or cancelled).
 */
export async function applyStreamOutcome(
  transactionHash: string,
  outcome: PaymentStreamOutcome
): Promise<boolean> {
  const payment = await prisma.payment.findFirst({
    where: {
      transactionHash,
      status: "SUBMITTED",
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
      amount: true,
      assetCode: true,
    },
  });

  if (!payment) return false;

  const terminalStatus = outcome === "success" ? "CONFIRMED" : "FAILED";
  const updated = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: "SUBMITTED",
    },
    data: {
      status: terminalStatus,
      reconciliationSource: "stream",
      ...(outcome === "failed" ? { errorMessage: ON_CHAIN_FAILED_MESSAGE } : {}),
    },
  });

  // Another worker or poll run already transitioned this payment
  if (updated.count !== 1) {
    return false;
  }

  if (outcome === "success") {
    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
      {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash,
        confirmedAt: new Date().toISOString(),
      },
      payment.userId
    );
  } else {
    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.PAYMENT_FAILED,
      {
        paymentId: payment.id,
        amount: payment.amount,
        assetCode: payment.assetCode,
        transactionHash,
        errorMessage: ON_CHAIN_FAILED_MESSAGE,
        failedAt: new Date().toISOString(),
      },
      payment.userId
    );
  }

  logger.info("payment-stream: payment reconciled via Horizon stream", {
    paymentId: payment.id,
    transactionHash,
    outcome,
  });

  return true;
}

/**
 * Reconciles any missed transactions that settled while the stream was disconnected.
 */
export async function reconcileMissedEvents(
  accountId: string,
  server: ReturnType<typeof getHorizonServer>,
  cursor?: string
): Promise<number> {
  try {
    let query = server.transactions().forAccount(accountId);
    if (cursor && cursor !== "now") {
      query = query.cursor(cursor);
    }
    const page = await query.limit(50).call();
    let reconciledCount = 0;

    for (const record of page.records) {
      if (record.hash && typeof record.successful === "boolean") {
        const transitioned = await applyStreamOutcome(
          record.hash,
          record.successful ? "success" : "failed"
        );
        if (transitioned) reconciledCount += 1;
      }
    }

    if (reconciledCount > 0) {
      logger.info("payment-stream: caught up missed transactions on reconnect", {
        accountId,
        reconciledCount,
        cursor,
      });
    }

    return reconciledCount;
  } catch (err) {
    logger.warn("payment-stream: error reconciling missed transactions on reconnect", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

function closeHandle(handle: StreamHandle): void {
  if (typeof handle === "function") {
    handle();
  } else if (handle && typeof handle.close === "function") {
    handle.close();
  }
}

/**
 * Connect a single Horizon account transaction stream with reconnect and backoff.
 */
function connectAccountStream(
  accountId: string,
  server: ReturnType<typeof getHorizonServer>,
  baseDelay: number,
  maxDelay: number,
  state: { stopped: boolean },
  handles: Map<string, StreamHandle>,
  timers: Set<ReturnType<typeof setTimeout>>,
  cursor: string,
  attempt = 0
): void {
  if (state.stopped) return;

  let nextCursor = cursor;

  try {
    const streamCaller = server
      .transactions()
      .forAccount(accountId)
      .cursor(nextCursor);

    const handle = streamCaller.stream({
      onmessage: async (transaction: HorizonStreamTransaction) => {
        if (transaction.paging_token) {
          nextCursor = transaction.paging_token;
        }
        if (!transaction.hash || typeof transaction.successful !== "boolean") {
          return;
        }

        await applyStreamOutcome(
          transaction.hash,
          transaction.successful ? "success" : "failed"
        );
      },
      onerror: () => {
        const oldHandle = handles.get(accountId);
        if (oldHandle) {
          closeHandle(oldHandle);
          handles.delete(accountId);
        }

        if (state.stopped) return;

        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt));
        logger.warn("payment-stream: connection dropped, scheduling reconnect", {
          accountId,
          attempt: attempt + 1,
          delayMs: delay,
          cursor: nextCursor,
        });

        const timer = setTimeout(async () => {
          timers.delete(timer);
          if (state.stopped) return;

          // Reconcile missed transactions before/upon reconnect
          await reconcileMissedEvents(accountId, server, nextCursor);

          connectAccountStream(
            accountId,
            server,
            baseDelay,
            maxDelay,
            state,
            handles,
            timers,
            nextCursor,
            attempt + 1
          );
        }, delay);

        timers.add(timer);
      },
    }) as StreamHandle;

    handles.set(accountId, handle);
    logger.info("payment-stream: Horizon transaction stream connected", {
      accountId,
      cursor: nextCursor,
    });
  } catch (err) {
    logger.error("payment-stream: failed to initialize stream for account", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start Horizon transaction streams for accounts with pending submitted payments.
 */
export async function startPaymentStatusStreams(
  options: PaymentStatusStreamOptions = {}
): Promise<PaymentStatusStreamController> {
  const baseDelay = options.reconnectBaseMs ?? 500;
  const maxDelay = options.reconnectMaxMs ?? 30_000;
  const refreshInterval = options.refreshIntervalMs ?? 30_000;
  const initialCursor = options.initialCursor ?? "now";
  const server = options.server ?? getHorizonServer();

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const handles = new Map<string, StreamHandle>();
  const connectedAccounts = new Set<string>();
  const state = { stopped: false };

  const attachAccount = (accountId: string) => {
    if (state.stopped || !accountId || connectedAccounts.has(accountId)) return;
    connectedAccounts.add(accountId);
    connectAccountStream(
      accountId,
      server,
      baseDelay,
      maxDelay,
      state,
      handles,
      timers,
      initialCursor
    );
  };

  const refresh = async () => {
    if (state.stopped) return;
    try {
      const pending = await prisma.payment.findMany({
        where: {
          status: "SUBMITTED",
          transactionHash: { not: null },
          sourceAccountId: { not: null },
          deletedAt: null,
        },
        select: { sourceAccountId: true },
        distinct: ["sourceAccountId"],
      });

      for (const row of pending) {
        if (row.sourceAccountId) {
          attachAccount(row.sourceAccountId);
        }
      }
    } catch (err) {
      logger.warn("payment-stream: failed to refresh accounts for streaming", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Connect explicit initial accounts if supplied
  if (options.initialAccounts) {
    for (const acc of options.initialAccounts) {
      attachAccount(acc);
    }
  }

  // Initial account discovery sweep
  await refresh();

  // Periodic discovery for accounts that submit payments after startup
  const refreshTimer = setInterval(() => {
    refresh().catch(() => {});
  }, refreshInterval);

  return {
    stop() {
      state.stopped = true;
      clearInterval(refreshTimer);
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const handle of handles.values()) {
        closeHandle(handle);
      }
      handles.clear();
      connectedAccounts.clear();
      logger.info("payment-stream: all Horizon streams stopped");
    },
    addAccount(accountId: string) {
      attachAccount(accountId);
    },
    getConnectedAccounts() {
      return Array.from(connectedAccounts);
    },
    isStopped() {
      return state.stopped;
    },
  };
}
