// SPDX-License-Identifier: MIT

/**
 * Horizon transaction streams for submitted payments.
 *
 * A stream is opened per source account and resumes from its last Horizon
 * paging token after disconnects. Payment updates use a conditional
 * SUBMITTED -> terminal transition, so a poll and a stream observing the same
 * transaction cannot produce duplicate transitions or webhooks.
 */

import prisma from "@/lib/prisma";
import { getHorizonServer } from "@/lib/stellar";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { logger } from "@/lib/logger";
import { ON_CHAIN_FAILED_MESSAGE } from "@/lib/payment-sync";

export type PaymentStreamOutcome = "success" | "failed";

export interface PaymentStatusStreamController {
  stop: () => void;
}

export interface PaymentStatusStreamOptions {
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** How often to discover accounts with payments submitted after startup. */
  refreshIntervalMs?: number;
  /** Injectable server for tests and alternate Horizon environments. */
  server?: ReturnType<typeof getHorizonServer>;
}

type HorizonTransaction = {
  hash?: string;
  successful?: boolean;
  paging_token?: string;
};

type StreamHandle = { close?: () => void };

async function applyStreamOutcome(
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

  const status = outcome === "success" ? "CONFIRMED" : "FAILED";
  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: "SUBMITTED" },
    data: {
      status,
      reconciliationSource: "stream",
      ...(outcome === "failed" ? { errorMessage: ON_CHAIN_FAILED_MESSAGE } : {}),
    },
  });
  if (updated.count !== 1) return false;

  dispatchWebhookEventAsync(
    outcome === "success"
      ? WEBHOOK_EVENTS.PAYMENT_CONFIRMED
      : WEBHOOK_EVENTS.PAYMENT_FAILED,
    {
      paymentId: payment.id,
      amount: payment.amount,
      assetCode: payment.assetCode,
      transactionHash,
      ...(outcome === "success"
        ? { confirmedAt: new Date().toISOString() }
        : {
            errorMessage: ON_CHAIN_FAILED_MESSAGE,
            failedAt: new Date().toISOString(),
          }),
    },
    payment.userId
  );
  return true;
}

/**
 * Start streams for every source account that currently has submitted
 * payments. Reconnects reuse the last paging token, allowing Horizon to replay
 * missed transactions after a connection failure.
 */
export async function startPaymentStatusStreams(
  options: PaymentStatusStreamOptions = {}
): Promise<PaymentStatusStreamController> {
  const baseDelay = options.reconnectBaseMs ?? 500;
  const maxDelay = options.reconnectMaxMs ?? 30_000;
  const refreshInterval = options.refreshIntervalMs ?? 30_000;
  const server = options.server ?? getHorizonServer();

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const handles = new Set<StreamHandle>();
  const connectedAccounts = new Set<string>();
  const state = { stopped: false };

  const refresh = async () => {
    if (state.stopped) return;
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
      const accountId = row.sourceAccountId;
      if (accountId && !connectedAccounts.has(accountId)) {
        connectedAccounts.add(accountId);
        connectAccount(accountId, server, baseDelay, maxDelay, state, handles, timers);
      }
    }
  };

  await refresh();
  const refreshTimer = setInterval(() => {
    refresh().catch((error) => {
      logger.warn("payment-sync: failed to refresh Horizon streams", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, refreshInterval);

  return {
    stop() {
      state.stopped = true;
      clearInterval(refreshTimer);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const handle of handles) handle.close?.();
      handles.clear();
    },
  };
}

function connectAccount(
  accountId: string,
  server: ReturnType<typeof getHorizonServer>,
  baseDelay: number,
  maxDelay: number,
  state: { stopped: boolean },
  handles: Set<StreamHandle>,
  timers: Set<ReturnType<typeof setTimeout>>,
  cursor?: string,
  attempt = 0
): void {
  if (state.stopped) return;
  let nextCursor = cursor ?? "now";
  const query = server.transactions().forAccount(accountId).cursor(nextCursor);
  const handle = query.stream({
    onmessage: async (transaction: HorizonTransaction) => {
      if (transaction.paging_token) nextCursor = transaction.paging_token;
      if (!transaction.hash || typeof transaction.successful !== "boolean") return;
      await applyStreamOutcome(
        transaction.hash,
        transaction.successful ? "success" : "failed"
      );
    },
    onerror: () => {
      handles.delete(handle);
      const delay = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const timer = setTimeout(() => {
        timers.delete(timer);
        connectAccount(
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
  handles.add(handle);
  logger.info("payment-sync: Horizon stream connected", { accountId, cursor: nextCursor });
}

export { applyStreamOutcome };
