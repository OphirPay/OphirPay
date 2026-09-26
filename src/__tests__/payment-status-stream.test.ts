// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  applyStreamOutcome,
  reconcileMissedEvents,
  startPaymentStatusStreams,
  type HorizonStreamTransaction,
} from "@/lib/payment-status-stream";
import { runPaymentStatusSync, ON_CHAIN_FAILED_MESSAGE } from "@/lib/payment-sync";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import type { getHorizonServer } from "@/lib/stellar";

// Mock prisma
const mockPrisma = vi.hoisted(() => ({
  payment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  paymentSyncRun: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: mockPrisma,
}));

// Mock webhook dispatcher
const mockDispatchWebhook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: mockDispatchWebhook,
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock stellar Horizon server
const mockHorizon = vi.hoisted(() => {
  let streamCallbacks: {
    onmessage?: (tx: HorizonStreamTransaction) => void;
    onerror?: (err: unknown) => void;
  } = {};
  const mockClose = vi.fn();

  const mockStream = vi.fn((callbacks) => {
    streamCallbacks = callbacks;
    return mockClose;
  });

  const mockCursor = vi.fn(() => ({
    stream: mockStream,
    limit: vi.fn(() => ({
      call: vi.fn().mockResolvedValue({ records: [] }),
    })),
  }));

  const mockForAccount = vi.fn(() => ({
    cursor: mockCursor,
    limit: vi.fn(() => ({
      call: vi.fn().mockResolvedValue({ records: [] }),
    })),
  }));

  const mockTransactionCall = vi.fn();

  return {
    streamCallbacks: () => streamCallbacks,
    mockClose,
    mockStream,
    mockCursor,
    mockForAccount,
    mockTransactionCall,
    server: {
      transactions: () => ({
        forAccount: mockForAccount,
        transaction: () => ({
          call: mockTransactionCall,
        }),
      }),
    },
  };
});

vi.mock("@/lib/stellar", () => ({
  getHorizonServer: () =>
    mockHorizon.server as unknown as ReturnType<typeof getHorizonServer>,
}));

describe("Horizon Payment Status Streaming (Issue #819)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("applyStreamOutcome", () => {
    it("transitions a SUBMITTED payment to CONFIRMED with reconciliationSource: stream", async () => {
      mockPrisma.payment.findFirst.mockResolvedValueOnce({
        id: "pmt_1",
        userId: "usr_1",
        amount: "100.00",
        assetCode: "XLM",
      });

      mockPrisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

      const transitioned = await applyStreamOutcome("tx_success_hash", "success");

      expect(transitioned).toBe(true);
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: "pmt_1",
          status: "SUBMITTED",
        },
        data: {
          status: "CONFIRMED",
          reconciliationSource: "stream",
        },
      });

      expect(mockDispatchWebhook).toHaveBeenCalledWith(
        WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
        expect.objectContaining({
          paymentId: "pmt_1",
          amount: "100.00",
          assetCode: "XLM",
          transactionHash: "tx_success_hash",
        }),
        "usr_1"
      );
    });

    it("transitions a SUBMITTED payment to FAILED with errorMessage and reconciliationSource: stream", async () => {
      mockPrisma.payment.findFirst.mockResolvedValueOnce({
        id: "pmt_failed_1",
        userId: "usr_2",
        amount: "50.00",
        assetCode: "USDC",
      });

      mockPrisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

      const transitioned = await applyStreamOutcome("tx_fail_hash", "failed");

      expect(transitioned).toBe(true);
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: "pmt_failed_1",
          status: "SUBMITTED",
        },
        data: {
          status: "FAILED",
          reconciliationSource: "stream",
          errorMessage: ON_CHAIN_FAILED_MESSAGE,
        },
      });

      expect(mockDispatchWebhook).toHaveBeenCalledWith(
        WEBHOOK_EVENTS.PAYMENT_FAILED,
        expect.objectContaining({
          paymentId: "pmt_failed_1",
          amount: "50.00",
          assetCode: "USDC",
          transactionHash: "tx_fail_hash",
          errorMessage: ON_CHAIN_FAILED_MESSAGE,
        }),
        "usr_2"
      );
    });

    it("deduplicates: returns false and skips webhook when payment was already transitioned", async () => {
      mockPrisma.payment.findFirst.mockResolvedValueOnce({
        id: "pmt_raced",
        userId: "usr_3",
        amount: "25.00",
        assetCode: "XLM",
      });

      // CAS update returns 0 rows updated because another process updated it
      mockPrisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });

      const transitioned = await applyStreamOutcome("tx_raced", "success");

      expect(transitioned).toBe(false);
      expect(mockDispatchWebhook).not.toHaveBeenCalled();
    });

    it("returns false if payment with transactionHash is not found in SUBMITTED state", async () => {
      mockPrisma.payment.findFirst.mockResolvedValueOnce(null);

      const transitioned = await applyStreamOutcome("tx_unknown", "success");

      expect(transitioned).toBe(false);
      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
      expect(mockDispatchWebhook).not.toHaveBeenCalled();
    });
  });

  describe("reconcileMissedEvents", () => {
    it("reconciles missed transaction records on reconnect", async () => {
      const mockRecords = [
        { hash: "tx_missed_1", successful: true, paging_token: "tok_1" },
        { hash: "tx_missed_2", successful: false, paging_token: "tok_2" },
      ];

      const customServer = {
        transactions: () => ({
          forAccount: () => ({
            cursor: () => ({
              limit: () => ({
                call: vi.fn().mockResolvedValue({ records: mockRecords }),
              }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getHorizonServer>;

      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({
          id: "pmt_missed_1",
          userId: "usr_1",
          amount: "10.00",
          assetCode: "XLM",
        })
        .mockResolvedValueOnce({
          id: "pmt_missed_2",
          userId: "usr_1",
          amount: "20.00",
          assetCode: "XLM",
        });

      mockPrisma.payment.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      const reconciledCount = await reconcileMissedEvents(
        "GA_ACCOUNT_1",
        customServer,
        "tok_0"
      );

      expect(reconciledCount).toBe(2);
      expect(mockDispatchWebhook).toHaveBeenCalledTimes(2);
    });
  });

  describe("startPaymentStatusStreams lifecycle & reconnects", () => {
    it("discovers pending submitted payments and connects Horizon streams", async () => {
      mockPrisma.payment.findMany.mockResolvedValueOnce([
        { sourceAccountId: "GA_SRC_101" },
        { sourceAccountId: "GA_SRC_102" },
      ]);

      const controller = await startPaymentStatusStreams({
        refreshIntervalMs: 60_000,
        server: mockHorizon.server as unknown as ReturnType<typeof getHorizonServer>,
      });

      expect(controller.getConnectedAccounts()).toContain("GA_SRC_101");
      expect(controller.getConnectedAccounts()).toContain("GA_SRC_102");
      expect(controller.isStopped()).toBe(false);

      controller.stop();
      expect(controller.isStopped()).toBe(true);
      expect(mockHorizon.mockClose).toHaveBeenCalled();
    });

    it("supports dynamic account addition via controller.addAccount", async () => {
      mockPrisma.payment.findMany.mockResolvedValueOnce([]);

      const controller = await startPaymentStatusStreams({
        refreshIntervalMs: 60_000,
        server: mockHorizon.server as unknown as ReturnType<typeof getHorizonServer>,
      });

      expect(controller.getConnectedAccounts()).toEqual([]);

      controller.addAccount("GA_NEW_ACC");
      expect(controller.getConnectedAccounts()).toEqual(["GA_NEW_ACC"]);

      // Idempotent: adding same account does not duplicate stream
      controller.addAccount("GA_NEW_ACC");
      expect(controller.getConnectedAccounts()).toEqual(["GA_NEW_ACC"]);

      controller.stop();
    });

    it("reconnects with exponential backoff on stream drop", async () => {
      vi.useFakeTimers();

      let streamErrorCallback: (() => void) | undefined;
      const customClose = vi.fn();
      let streamCalls = 0;

      const customServer = {
        transactions: () => ({
          forAccount: () => ({
            cursor: () => ({
              stream: vi.fn(({ onerror }) => {
                streamCalls += 1;
                streamErrorCallback = onerror;
                return customClose;
              }),
              limit: () => ({
                call: vi.fn().mockResolvedValue({ records: [] }),
              }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getHorizonServer>;

      mockPrisma.payment.findMany.mockResolvedValueOnce([
        { sourceAccountId: "GA_DROP_TEST" },
      ]);

      const controller = await startPaymentStatusStreams({
        reconnectBaseMs: 100,
        reconnectMaxMs: 1000,
        server: customServer,
      });

      expect(streamCalls).toBe(1);

      // Trigger error on active stream
      expect(streamErrorCallback).toBeDefined();
      streamErrorCallback!();
      expect(customClose).toHaveBeenCalled();

      // Advance timers by backoff delay (100ms * 2^0 = 100ms)
      await vi.advanceTimersByTimeAsync(110);
      expect(streamCalls).toBe(2);

      controller.stop();
    });
  });

  describe("Safety net backstop: Polling & Deduplication", () => {
    it("polling job updates SUBMITTED payment with reconciliationSource: poll", async () => {
      mockPrisma.paymentSyncRun.create.mockResolvedValueOnce({
        id: "run_1",
        createdAt: new Date(),
      });
      mockPrisma.paymentSyncRun.update.mockResolvedValueOnce({});

      mockPrisma.payment.findMany.mockResolvedValueOnce([
        {
          id: "pmt_poll_1",
          userId: "usr_10",
          amount: "15.00",
          assetCode: "XLM",
          transactionHash: "tx_poll_hash",
        },
      ]);

      // Mock horizon transaction lookup for poll
      mockHorizon.mockTransactionCall.mockResolvedValueOnce({ successful: true });

      mockPrisma.payment.updateMany.mockResolvedValueOnce({ count: 1 });

      const summary = await runPaymentStatusSync("cron");

      expect(summary.status).toBe("success");
      expect(summary.confirmed).toBe(1);
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "pmt_poll_1", status: "SUBMITTED" },
        data: { status: "CONFIRMED", reconciliationSource: "poll" },
      });
      expect(mockDispatchWebhook).toHaveBeenCalledWith(
        WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
        expect.objectContaining({
          paymentId: "pmt_poll_1",
          transactionHash: "tx_poll_hash",
        }),
        "usr_10"
      );
    });

    it("prevents double transition when stream and poll race on the same payment", async () => {
      mockPrisma.paymentSyncRun.create.mockResolvedValueOnce({
        id: "run_race",
        createdAt: new Date(),
      });
      mockPrisma.paymentSyncRun.update.mockResolvedValueOnce({});

      // Polling scanned the payment while it was still SUBMITTED
      mockPrisma.payment.findMany.mockResolvedValueOnce([
        {
          id: "pmt_race_1",
          userId: "usr_race",
          amount: "50.00",
          assetCode: "XLM",
          transactionHash: "tx_race_hash",
        },
      ]);

      mockHorizon.mockTransactionCall.mockResolvedValueOnce({ successful: true });

      // But before polling updates it, the streaming event already updated it to CONFIRMED!
      // Therefore, polling updateMany returns count: 0
      mockPrisma.payment.updateMany.mockResolvedValueOnce({ count: 0 });

      const summary = await runPaymentStatusSync("cron");

      expect(summary.status).toBe("success");
      // Counter is NOT incremented
      expect(summary.confirmed).toBe(0);
      // No duplicate webhook is sent by polling
      expect(mockDispatchWebhook).not.toHaveBeenCalled();
    });
  });
});
