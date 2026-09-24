// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindFirst,
  mockCreate,
  mockGetAuthContext,
  mockInvokeContractFunction,
  mockSubmitContractInvocation,
  mockSimulateContractCall,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockGetAuthContext: vi.fn(),
  mockInvokeContractFunction: vi.fn(),
  mockSubmitContractInvocation: vi.fn(),
  mockSimulateContractCall: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findFirst: mockFindFirst,
      create: mockCreate,
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

vi.mock("@/lib/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contracts")>();
  return {
    ...actual,
    invokeContractFunction: mockInvokeContractFunction,
    submitContractInvocation: mockSubmitContractInvocation,
    simulateContractCall: mockSimulateContractCall,
  };
});

vi.mock("@/lib/wallets", () => ({
  getActiveWalletConnector: vi.fn(() => ({
    signTransaction: vi.fn().mockResolvedValue("AAAA_SIGNED_XDR"),
  })),
}));

import { createPaymentSchema } from "@/lib/validation-schemas";
import { generateCsrfToken } from "@/lib/csrf";
import { POST } from "@/app/api/payments/route";
import { recordPaymentOnChain } from "@/lib/contracts";
import {
  recordPaymentOnChainIdempotent,
  emitPaymentIdempotent,
  getPaymentIdByIdempotencyKey,
  getPaymentByIdempotencyKey,
} from "@/lib/contract-advanced";

function csrfHeaders(): Record<string, string> {
  const token = generateCsrfToken();
  return { "x-csrf-token": token, cookie: `__Host-csrf=${token}` };
}

const USER_ID = "user-123";
const SOURCE_ACCOUNT = "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY";
const DEST_ADDRESS = "GA5AZNWWOW5PXPNHBVRJOB2ZPZO3PXN5VTXTXOIJTACZZHE5ZA7CAH7H";

describe("On-Chain Idempotency Schema & API Agreement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ userId: USER_ID });
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "pay-1",
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it("createPaymentSchema accepts optional idempotencyKey", () => {
    const input = {
      amount: 100,
      sourceAccountId: SOURCE_ACCOUNT,
      destAddress: DEST_ADDRESS,
      assetCode: "XLM",
      idempotencyKey: "idem-key-abc-123",
    };
    const parsed = createPaymentSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.idempotencyKey).toBe("idem-key-abc-123");
    }
  });

  it("POST /api/payments creates new payment when idempotencyKey has not been seen", async () => {
    const request = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...csrfHeaders(),
      },
      body: JSON.stringify({
        amount: 50,
        sourceAccountId: SOURCE_ACCOUNT,
        destAddress: DEST_ADDRESS,
        assetCode: "XLM",
        idempotencyKey: "unique-payment-attempt-1",
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.idempotencyKey).toBe("unique-payment-attempt-1");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("POST /api/payments returns existing payment (deduplicated) when idempotencyKey matches", async () => {
    const existingPayment = {
      id: "pay-existing-99",
      userId: USER_ID,
      amount: 50,
      assetCode: "XLM",
      status: "CREATED",
      idempotencyKey: "duplicate-attempt-key",
      createdAt: new Date(),
    };
    mockFindFirst.mockResolvedValue(existingPayment);

    const request = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...csrfHeaders(),
      },
      body: JSON.stringify({
        amount: 50,
        sourceAccountId: SOURCE_ACCOUNT,
        destAddress: DEST_ADDRESS,
        assetCode: "XLM",
        idempotencyKey: "duplicate-attempt-key",
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("pay-existing-99");
    expect(body.meta.deduplicated).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("POST /api/payments respects Idempotency-Key header", async () => {
    const request = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "idempotency-key": "header-keyed-attempt-101",
        ...csrfHeaders(),
      },
      body: JSON.stringify({
        amount: 25,
        sourceAccountId: SOURCE_ACCOUNT,
        destAddress: DEST_ADDRESS,
        assetCode: "XLM",
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.idempotencyKey).toBe("header-keyed-attempt-101");
  });
});

describe("recordPaymentOnChain Contract Helper", () => {
  it("passes idempotencyKey as 7th argument ScVal to record_payment", async () => {
    mockInvokeContractFunction.mockResolvedValue({
      status: "AWAITING_SIGNATURE",
      xdr: "AAAA_UNSIGNED_XDR",
    });
    mockSubmitContractInvocation.mockResolvedValue({
      status: "SUCCESS",
      txHash: "0xhash123",
      returnValue: 1n,
    });

    const signTx = vi.fn().mockResolvedValue("AAAA_SIGNED_XDR");

    const result = await recordPaymentOnChain({
      payer: SOURCE_ACCOUNT,
      payee: DEST_ADDRESS,
      amountStroops: 10_000_000,
      txHash: "0xhash123",
      metadata: "invoice_1",
      idempotencyKey: "idem-soroban-key-42",
      signTransaction: signTx,
    });

    expect(result.status).toBe("CONFIRMED");
    expect(mockInvokeContractFunction).toHaveBeenCalledWith(
      expect.any(String),
      "record_payment",
      SOURCE_ACCOUNT,
      expect.arrayContaining([
        expect.anything(), // payer
        expect.anything(), // payee
        expect.anything(), // amount
        expect.anything(), // asset
        expect.anything(), // tx_hash
        expect.anything(), // metadata
        expect.anything(), // idempotency_key
      ])
    );

    const callArgs = mockInvokeContractFunction.mock.calls[0][3];
    expect(callArgs.length).toBe(7);
  });
});

describe("Advanced Contract Idempotency Functions", () => {
  it("recordPaymentOnChainIdempotent invokes record_payment with idempotency key", async () => {
    mockInvokeContractFunction.mockResolvedValue({
      status: "AWAITING_SIGNATURE",
      xdr: "AAAA_UNSIGNED_XDR",
    });
    mockSubmitContractInvocation.mockResolvedValue({
      status: "SUCCESS",
      txHash: "0xidem_call_hash",
      returnValue: 5n,
    });

    const result = await recordPaymentOnChainIdempotent(
      SOURCE_ACCOUNT,
      DEST_ADDRESS,
      50_000_000n,
      "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      "0xtxhash",
      "meta",
      "my-idempotency-key"
    );

    expect(result.success).toBe(true);
    expect(mockInvokeContractFunction).toHaveBeenCalledWith(
      expect.any(String),
      "record_payment",
      SOURCE_ACCOUNT,
      expect.any(Array)
    );
    const args = mockInvokeContractFunction.mock.calls[0][3];
    expect(args.length).toBe(7);
  });

  it("emitPaymentIdempotent invokes emit_payment_idempotent on emitter contract", async () => {
    mockInvokeContractFunction.mockResolvedValue({
      status: "AWAITING_SIGNATURE",
      xdr: "AAAA_UNSIGNED_XDR",
    });
    mockSubmitContractInvocation.mockResolvedValue({
      status: "SUCCESS",
      txHash: "0xemit_hash",
      returnValue: 1n,
    });

    const result = await emitPaymentIdempotent(
      SOURCE_ACCOUNT,
      "OphirPay",
      SOURCE_ACCOUNT,
      DEST_ADDRESS,
      100_000_000n,
      "0xhash_emit",
      "emitter-key-77"
    );

    expect(result.success).toBe(true);
    expect(mockInvokeContractFunction).toHaveBeenCalledWith(
      expect.any(String),
      "emit_payment_idempotent",
      SOURCE_ACCOUNT,
      expect.any(Array)
    );
    const args = mockInvokeContractFunction.mock.calls[0][3];
    expect(args.length).toBe(7);
  });

  it("getPaymentIdByIdempotencyKey simulates read-only query", async () => {
    mockSimulateContractCall.mockResolvedValue({
      status: "SUCCESS",
      returnValue: 10n,
    });

    const res = await getPaymentIdByIdempotencyKey(SOURCE_ACCOUNT, "query-key-1");
    expect(mockSimulateContractCall).toHaveBeenCalledWith(
      expect.any(String),
      "get_payment_id_by_idempotency_key",
      SOURCE_ACCOUNT,
      expect.any(Array)
    );
  });

  it("getPaymentByIdempotencyKey simulates read-only query", async () => {
    mockSimulateContractCall.mockResolvedValue({
      status: "SUCCESS",
      returnValue: { id: 10n, amount: 50_000_000n },
    });

    const res = await getPaymentByIdempotencyKey(SOURCE_ACCOUNT, "query-key-1");
    expect(mockSimulateContractCall).toHaveBeenCalledWith(
      expect.any(String),
      "get_payment_by_idempotency_key",
      SOURCE_ACCOUNT,
      expect.any(Array)
    );
  });
});
