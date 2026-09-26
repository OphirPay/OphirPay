// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockPaymentFindMany,
  mockPaymentUpdateMany,
  mockPaymentSyncRunCreate,
  mockPaymentSyncRunUpdate,
  mockDispatchWebhookEventAsync,
  mockTransactionCall,
  mockTransactionStream,
} = vi.hoisted(() => ({
  mockPaymentFindMany: vi.fn(),
  mockPaymentUpdateMany: vi.fn(),
  mockPaymentSyncRunCreate: vi.fn(),
  mockPaymentSyncRunUpdate: vi.fn(),
  mockDispatchWebhookEventAsync: vi.fn(),
  mockTransactionCall: vi.fn(),
  mockTransactionStream: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: mockPaymentFindMany,
      updateMany: mockPaymentUpdateMany,
    },
    paymentSyncRun: {
      create: mockPaymentSyncRunCreate,
      update: mockPaymentSyncRunUpdate,
    },
  },
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: mockDispatchWebhookEventAsync,
}));

vi.mock("@/lib/stellar", () => ({
  getHorizonServer: () => ({
    transactions: () => ({
      transaction: () => ({
        call: mockTransactionCall,
      }),
      cursor: () => ({
        stream: mockTransactionStream,
      }),
    }),
  }),
}));

import {
  attachReconciliationMetadata,
  lookupOnChainOutcome,
  reconcilePaymentByTxHash,
  handleTransactionStreamEvent,
  startPaymentStatusStream,
  runPaymentStatusSync,
  main,
  ON_CHAIN_FAILED_MESSAGE,
  type HorizonTransactionEvent,
  type PaymentStatusStreamOptions,
} from "@/lib/payment-sync";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";

describe("payment-sync: Horizon Streaming & Polling Reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("attachReconciliationMetadata", () => {
    it("attaches STREAM metadata to empty metadata", () => {
      const meta = attachReconciliationMetadata(null, "STREAM");
      const parsed = JSON.parse(meta);
      expect(parsed.reconciledBy).toBe("STREAM");
      expect(parsed.reconciliationMechanism).toBe("STREAM");
      expect(parsed.reconciledAt).toBeDefined();
    });

    it("preserves existing JSON fields and adds POLL metadata", () => {
      const existing = JSON.stringify({ note: "client payment", destAddress: "GB123" });
      const meta = attachReconciliationMetadata(existing, "POLL");
      const parsed = JSON.parse(meta);
      expect(parsed.note).toBe("client payment");
      expect(parsed.destAddress).toBe("GB123");
      expect(parsed.reconciledBy).toBe("POLL");
      expect(parsed.reconciliationMechanism).toBe("POLL");
      expect(parsed.reconciledAt).toBeDefined();
    });

    it("wraps non-JSON raw metadata strings", () => {
      const meta = attachReconciliationMetadata("LEGACY_RAW_DATA", "STREAM");
      const parsed = JSON.parse(meta);
      expect(parsed.raw).toBe("LEGACY_RAW_DATA");
      expect(parsed.reconciledBy).toBe("STREAM");
    });
  });

  describe("lookupOnChainOutcome", () => {
    it("returns 'success' when Horizon reports successful: true", async () => {
      mockTransactionCall.mockResolvedValueOnce({ successful: true });
      const outcome = await lookupOnChainOutcome("tx_success_123");
      expect(outcome).toBe("success");
    });

    it("returns 'failed' when Horizon reports successful: false", async () => {
      mockTransactionCall.mockResolvedValueOnce({ successful: false });
      const outcome = await lookupOnChainOutcome("tx_failed_123");
      expect(outcome).toBe("failed");
    });

    it("returns 'not_found' on 404 response", async () => {
      mockTransactionCall.mockRejectedValueOnce({ response: { status: 404 } });
      const outcome = await lookupOnChainOutcome("tx_pending_123");
      expect(outcome).toBe("not_found");
    });

    it("returns 'error' on generic network error without throwing", async () => {
      mockTransactionCall.mockRejectedValueOnce(new Error("Network timeout"));
      const outcome = await lookupOnChainOutcome("tx_error_123");
      expect(outcome).toBe("error");
    });
  });

  describe("reconcilePaymentByTxHash (Atomic CAS State Transition)", () => {
    it("transitions SUBMITTED payment to CONFIRMED on success and fires webhook", async () => {
      mockPaymentFindMany.mockResolvedValueOnce([
        {
          id: "pay_1",
          userId: "user_1",
          amount: "100.0",
          assetCode: "XLM",
          transactionHash: "tx_abc",
          metadata: null,
        },
      ]);
      mockPaymentUpdateMany.mockResolvedValueOnce({ count: 1 });

      const results = await reconcilePaymentByTxHash("tx_abc", "success", "STREAM");

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        paymentId: "pay_1",
        transactionHash: "tx_abc",
        status: "CONFIRMED",
        mechanism: "STREAM",
      });

      expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
        where: { id: "pay_1", status: "SUBMITTED" },
        data: expect.objectContaining({
          status: "CONFIRMED",
          completedAt: expect.any(Date),
          metadata: expect.stringContaining('"reconciledBy":"STREAM"'),
        }),
      });

      expect(mockDispatchWebhookEventAsync).toHaveBeenCalledWith(
        WEBHOOK_EVENTS.PAYMENT_CONFIRMED,
        expect.objectContaining({
          paymentId: "pay_1",
          amount: "100.0",
          assetCode: "XLM",
          transactionHash: "tx_abc",
          reconciledBy: "STREAM",
        }),
        "user_1"
      );
    });

    it("transitions SUBMITTED payment to FAILED with error message and fires webhook", async () => {
      mockPaymentFindMany.mockResolvedValueOnce([
        {
          id: "pay_2",
          userId: "user_2",
          amount: "50.0",
          assetCode: "USDC",
          transactionHash: "tx_fail",
          metadata: null,
        },
      ]);
      mockPaymentUpdateMany.mockResolvedValueOnce({ count: 1 });

      const results = await reconcilePaymentByTxHash("tx_fail", "failed", "POLL");

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        paymentId: "pay_2",
        transactionHash: "tx_fail",
        status: "FAILED",
        mechanism: "POLL",
      });

      expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
        where: { id: "pay_2", status: "SUBMITTED" },
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: ON_CHAIN_FAILED_MESSAGE,
          metadata: expect.stringContaining('"reconciledBy":"POLL"'),
        }),
      });

      expect(mockDispatchWebhookEventAsync).toHaveBeenCalledWith(
        WEBHOOK_EVENTS.PAYMENT_FAILED,
        expect.objectContaining({
          paymentId: "pay_2",
          transactionHash: "tx_fail",
          errorMessage: ON_CHAIN_FAILED_MESSAGE,
          reconciledBy: "POLL",
        }),
        "user_2"
      );
    });

    it("deduplicates concurrent transitions (CAS returns count 0, skips duplicate webhook)", async () => {
      mockPaymentFindMany.mockResolvedValueOnce([
        {
          id: "pay_3",
          userId: "user_3",
          amount: "25.0",
          assetCode: "XLM",
          transactionHash: "tx_race",
          metadata: null,
        },
      ]);
      // Another worker/stream already transitioned the payment row
      mockPaymentUpdateMany.mockResolvedValueOnce({ count: 0 });

      const results = await reconcilePaymentByTxHash("tx_race", "success", "POLL");

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("SKIPPED");
      expect(mockDispatchWebhookEventAsync).not.toHaveBeenCalled();
    });

    it("returns empty array when no pending payment matches txHash", async () => {
      mockPaymentFindMany.mockResolvedValueOnce([]);
      const results = await reconcilePaymentByTxHash("tx_unknown", "success", "STREAM");
      expect(results).toEqual([]);
      expect(mockPaymentUpdateMany).not.toHaveBeenCalled();
      expect(mockDispatchWebhookEventAsync).not.toHaveBeenCalled();
    });
  });

  describe("handleTransactionStreamEvent", () => {
    it("parses transaction stream event and executes stream reconciliation", async () => {
      mockPaymentFindMany.mockResolvedValueOnce([
        {
          id: "pay_stream",
          userId: "user_stream",
          amount: "10.0",
          assetCode: "XLM",
          transactionHash: "tx_stream_1",
          metadata: null,
        },
      ]);
      mockPaymentUpdateMany.mockResolvedValueOnce({ count: 1 });

      const results = await handleTransactionStreamEvent({
        hash: "tx_stream_1",
        successful: true,
        paging_token: "1001",
      });

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("CONFIRMED");
      expect(results[0].mechanism).toBe("STREAM");
    });

    it("returns empty array for invalid event payload", async () => {
      const results = await handleTransactionStreamEvent({} as unknown as HorizonTransactionEvent);
      expect(results).toEqual([]);
    });
  });

  describe("startPaymentStatusStream (Lifecycle, Reconnection & Deduplication)", () => {
    it("subscribes to Horizon transactions stream and handles message", async () => {
      let messageHandler: ((tx: HorizonTransactionEvent) => void) | undefined;
      const mockClose = vi.fn();

      const mockServer: NonNullable<PaymentStatusStreamOptions["server"]> = {
        transactions: () => ({
          cursor: (_c: string) => ({
            stream: (opts: { onmessage?: (tx: HorizonTransactionEvent) => void }) => {
              messageHandler = opts.onmessage;
              return mockClose;
            },
          }),
        }),
      };

      const onConfirmed = vi.fn();
      const onStatusChange = vi.fn();

      mockPaymentFindMany.mockResolvedValue([
        {
          id: "pay_s1",
          userId: "u1",
          amount: "15.0",
          assetCode: "XLM",
          transactionHash: "tx_stream_ok",
          metadata: null,
        },
      ]);
      mockPaymentUpdateMany.mockResolvedValue({ count: 1 });

      const handle = startPaymentStatusStream({
        cursor: "100",
        server: mockServer,
        onPaymentConfirmed: onConfirmed,
        onStatusChange,
      });

      expect(handle.getStatus()).toBe("connected");
      expect(handle.getCursor()).toBe("100");

      // Simulate stream message
      expect(messageHandler).toBeDefined();
      await messageHandler!({
        hash: "tx_stream_ok",
        successful: true,
        paging_token: "200",
      });

      expect(handle.getCursor()).toBe("200");
      expect(onConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: "pay_s1",
          status: "CONFIRMED",
          mechanism: "STREAM",
        })
      );

      handle.stop();
      expect(handle.getStatus()).toBe("stopped");
      expect(mockClose).toHaveBeenCalled();
    });

    it("reconnects on stream error with exponential backoff and triggers catch-up sync", async () => {
      vi.useFakeTimers();

      let errorHandler: ((err: unknown) => void) | undefined;
      let streamCalls = 0;

      const mockServer: NonNullable<PaymentStatusStreamOptions["server"]> = {
        transactions: () => ({
          cursor: () => ({
            stream: (opts: {
              onmessage?: (tx: HorizonTransactionEvent) => void;
              onerror?: (err: unknown) => void;
            }) => {
              streamCalls += 1;
              errorHandler = opts.onerror;
              return vi.fn();
            },
          }),
        }),
      };

      // Mock runPaymentStatusSync internals
      mockPaymentSyncRunCreate.mockResolvedValue({
        id: "run_reconnect",
        createdAt: new Date(),
      });
      mockPaymentFindMany.mockResolvedValue([]);
      mockPaymentSyncRunUpdate.mockResolvedValue({});

      const onStatusChange = vi.fn();

      const handle = startPaymentStatusStream({
        cursor: "50",
        server: mockServer,
        initialDelayMs: 200,
        maxBackoffMs: 2000,
        autoReconcileOnReconnect: true,
        onStatusChange,
      });

      expect(streamCalls).toBe(1);
      expect(handle.getStatus()).toBe("connected");

      // Trigger error
      errorHandler!(new Error("Connection reset"));
      expect(handle.getStatus()).toBe("reconnecting");
      expect(onStatusChange).toHaveBeenCalledWith("reconnecting", expect.any(Error));

      // Advance timers by backoff delay
      await vi.advanceTimersByTimeAsync(200);

      // Verify backfill sync was initiated and reconnected
      expect(mockPaymentSyncRunCreate).toHaveBeenCalled();
      expect(streamCalls).toBe(2);

      handle.stop();
      expect(handle.getStatus()).toBe("stopped");
    });
  });

  describe("runPaymentStatusSync (Polling Backstop)", () => {
    it("completes full sync run recording scanned, confirmed, failed, notFound, and errors", async () => {
      mockPaymentSyncRunCreate.mockResolvedValueOnce({
        id: "run_full_1",
        createdAt: new Date(),
      });

      mockPaymentFindMany.mockResolvedValueOnce([
        {
          id: "pay_conf",
          userId: "u1",
          amount: "10",
          assetCode: "XLM",
          transactionHash: "tx_1",
          metadata: null,
        },
        {
          id: "pay_fail",
          userId: "u2",
          amount: "20",
          assetCode: "XLM",
          transactionHash: "tx_2",
          metadata: null,
        },
        {
          id: "pay_not_found",
          userId: "u3",
          amount: "30",
          assetCode: "XLM",
          transactionHash: "tx_3",
          metadata: null,
        },
      ]);

      mockTransactionCall
        .mockResolvedValueOnce({ successful: true }) // tx_1
        .mockResolvedValueOnce({ successful: false }) // tx_2
        .mockRejectedValueOnce({ response: { status: 404 } }); // tx_3

      // Reconcile DB updates
      mockPaymentFindMany
        .mockResolvedValueOnce([
          {
            id: "pay_conf",
            userId: "u1",
            amount: "10",
            assetCode: "XLM",
            transactionHash: "tx_1",
            metadata: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "pay_fail",
            userId: "u2",
            amount: "20",
            assetCode: "XLM",
            transactionHash: "tx_2",
            metadata: null,
          },
        ]);

      mockPaymentUpdateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 1 });

      mockPaymentSyncRunUpdate.mockResolvedValueOnce({});

      const summary = await runPaymentStatusSync("cron");

      expect(summary.status).toBe("success");
      expect(summary.scanned).toBe(3);
      expect(summary.confirmed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.notFound).toBe(1);
      expect(summary.errors).toBe(0);

      expect(mockPaymentSyncRunUpdate).toHaveBeenCalledWith({
        where: { id: "run_full_1" },
        data: expect.objectContaining({
          status: "success",
          scanned: 3,
          confirmed: 1,
          failed: 1,
          notFound: 1,
          errors: 0,
        }),
      });
    });

    it("handles error thrown during database query gracefully", async () => {
      mockPaymentSyncRunCreate.mockResolvedValueOnce({
        id: "run_err_1",
        createdAt: new Date(),
      });
      mockPaymentFindMany.mockRejectedValueOnce(new Error("Database connection lost"));
      mockPaymentSyncRunUpdate.mockResolvedValueOnce({});

      const summary = await runPaymentStatusSync("admin");

      expect(summary.status).toBe("error");
      expect(summary.errorMessage).toBe("Database connection lost");
      expect(mockPaymentSyncRunUpdate).toHaveBeenCalledWith({
        where: { id: "run_err_1" },
        data: expect.objectContaining({
          status: "error",
          errorMessage: "Database connection lost",
        }),
      });
    });
  });

  describe("main() Entrypoint & Boundary Robustness", () => {
    it("handles boundary null/undefined/primitive inputs without uncaught exceptions", async () => {
      const resNull = await main(null);
      expect(resNull).toEqual({
        status: "handled",
        mode: "poll",
        boundary: true,
        pollSummary: null,
        error: null,
      });

      const resUndefined = await main(undefined);
      expect(resUndefined.status).toBe("handled");
      expect(resUndefined.boundary).toBe(true);

      const resString = await main("invalid_string_argument");
      expect(resString.status).toBe("handled");

      const resNum = await main(42);
      expect(resNum.status).toBe("handled");
    });

    it("executes default poll mode when passed empty object", async () => {
      mockPaymentSyncRunCreate.mockResolvedValueOnce({
        id: "run_m1",
        createdAt: new Date(),
      });
      mockPaymentFindMany.mockResolvedValueOnce([]);
      mockPaymentSyncRunUpdate.mockResolvedValueOnce({});

      const res = await main({});
      expect(res.status).toBe("completed");
      expect(res.mode).toBe("poll");
      expect(res.pollSummary).toBeDefined();
      expect(res.error).toBeNull();
    });

    it("executes stream mode when mode='stream'", async () => {
      mockTransactionStream.mockReturnValue(vi.fn());

      const res = await main({ mode: "stream", timeoutMs: 50 });
      expect(res.status).toBe("started");
      expect(res.mode).toBe("stream");
      expect(res.streamStarted).toBe(true);
    });

    it("executes both mode when mode='both'", async () => {
      mockTransactionStream.mockReturnValue(vi.fn());
      mockPaymentSyncRunCreate.mockResolvedValueOnce({
        id: "run_both",
        createdAt: new Date(),
      });
      mockPaymentFindMany.mockResolvedValueOnce([]);
      mockPaymentSyncRunUpdate.mockResolvedValueOnce({});

      const res = await main({ mode: "both" });
      expect(res.status).toBe("completed");
      expect(res.mode).toBe("both");
      expect(res.streamStarted).toBe(true);
      expect(res.pollSummary).toBeDefined();
    });
  });
});
