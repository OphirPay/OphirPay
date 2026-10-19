// SPDX-License-Identifier: MIT
//
// Verification test suite for deterministic Soroban RPC fixtures and mocks — Issue #1298.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { xdr } from "@stellar/stellar-sdk";
import {
  SIGNER_A,
  scValVoid,
  scValU32,
  scValU64,
  mockTransactionResult,
  getReturnValueForTxType,
  deterministicSimulateResponse,
  deterministicSendResponse,
  deterministicGetTransactionResponse,
  fakeFreighterInitScript,
  createDeterministicRpcHandler,
} from "../../e2e/helpers/stellar-mock";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

describe("Deterministic XDR Builders & Fixtures — #1298", () => {
  it("generates structurally valid base64 XDR for scValVoid", () => {
    const raw = scValVoid();
    expect(typeof raw).toBe("string");
    const parsed = xdr.ScVal.fromXDR(raw, "base64");
    expect(parsed.switch().name).toBe("scvVoid");
  });

  it("generates structurally valid base64 XDR for scValU32", () => {
    const raw = scValU32(42);
    const parsed = xdr.ScVal.fromXDR(raw, "base64");
    expect(parsed.switch().name).toBe("scvU32");
    expect(parsed.u32()).toBe(42);
  });

  it("generates structurally valid base64 XDR for scValU64", () => {
    const raw = scValU64("1001");
    const parsed = xdr.ScVal.fromXDR(raw, "base64");
    expect(parsed.switch().name).toBe("scvU64");
    expect(parsed.u64().toBigInt().toString()).toBe("1001");
  });

  it("generates structurally valid TransactionResult XDR", () => {
    const raw = mockTransactionResult();
    const parsed = xdr.TransactionResult.fromXDR(raw, "base64");
    expect(parsed.feeCharged().toBigInt().toString()).toBe("100");
    expect(parsed.result().switch().name).toBe("txSuccess");
  });

  it("maps core transaction types to correct Soroban return values", () => {
    // Payment -> void
    const paymentVal = xdr.ScVal.fromXDR(getReturnValueForTxType("payment"), "base64");
    expect(paymentVal.switch().name).toBe("scvVoid");

    // Batch payment -> u32
    const batchVal = xdr.ScVal.fromXDR(getReturnValueForTxType("batch_payment"), "base64");
    expect(batchVal.switch().name).toBe("scvU32");
    expect(batchVal.u32()).toBe(10);

    // Escrow -> u64 (1001)
    const escrowVal = xdr.ScVal.fromXDR(getReturnValueForTxType("escrow"), "base64");
    expect(escrowVal.switch().name).toBe("scvU64");
    expect(escrowVal.u64().toBigInt().toString()).toBe("1001");

    // Stream -> u64 (2001)
    const streamVal = xdr.ScVal.fromXDR(getReturnValueForTxType("stream"), "base64");
    expect(streamVal.switch().name).toBe("scvU64");
    expect(streamVal.u64().toBigInt().toString()).toBe("2001");
  });
});

describe("Deterministic RPC Method Response Generators — #1298", () => {
  it("builds realistic simulateTransaction responses", () => {
    const res = deterministicSimulateResponse({ txType: "escrow" });
    expect(res.latestLedger).toBe(42000);
    expect(res.transactionData).toBeDefined();
    expect(res.minResourceFee).toBe("100");
    const results = res.results as Array<{ xdr: string }>;
    expect(results).toHaveLength(1);
    const parsed = xdr.ScVal.fromXDR(results[0].xdr, "base64");
    expect(parsed.u64().toBigInt().toString()).toBe("1001");
  });

  it("builds error simulateTransaction responses when shouldFail is true", () => {
    const res = deterministicSimulateResponse({
      shouldFail: true,
      failureError: "Contract host trap: out of gas",
    });
    expect(res.error).toBe("Contract host trap: out of gas");
  });

  it("builds deterministic sendTransaction response in PENDING state", () => {
    const res = deterministicSendResponse({ txHash: "feedbeef".repeat(8) });
    expect(res.status).toBe("PENDING");
    expect(res.hash).toBe("feedbeef".repeat(8));
  });

  it("builds deterministic sendTransaction error response when shouldFail is true", () => {
    const res = deterministicSendResponse({
      shouldFail: true,
      failureError: "tx_insufficient_fee",
    });
    expect(res.status).toBe("ERROR");
    expect(res.errorResult).toBe("tx_insufficient_fee");
  });

  it("builds deterministic getTransaction response in SUCCESS state", () => {
    const res = deterministicGetTransactionResponse({ txType: "stream" });
    expect(res.status).toBe("SUCCESS");
    expect(res.resultXdr).toBeDefined();
    expect(res.resultMetaXdr).toBeDefined();
    expect(res.returnValue).toBeDefined();
  });
});

describe("Deterministic Wallet Simulation Script — #1298", () => {
  it("injects address and handles rejectSigning configuration", () => {
    const scriptNormal = fakeFreighterInitScript(SIGNER_A);
    expect(scriptNormal).toContain(SIGNER_A);
    expect(scriptNormal).toContain("window.freighter");
    expect(scriptNormal).toContain("signTransaction");
    expect(scriptNormal).toContain("signAuthEntry");

    const scriptReject = fakeFreighterInitScript({
      address: SIGNER_A,
      rejectSigning: true,
    });
    expect(scriptReject).toContain("rejectSigning: true");
    expect(scriptReject).toContain("User declined transaction signing");
  });
});

describe("Deterministic RPC Route Handler — #1298", () => {
  it("constructs executable route handler function", () => {
    const handler = createDeterministicRpcHandler({ txType: "batch_payment" });
    expect(typeof handler).toBe("function");
  });
});

describe("Documentation and Configuration Verification — #1298", () => {
  it("documents offline testing and mock RPC in docs/E2E_TESTING.md", () => {
    const doc = read("docs/E2E_TESTING.md");
    expect(doc).toContain("Deterministic Offline Mode & Soroban RPC Fixtures");
    expect(doc).toContain("installDeterministicRpcMocks");
    expect(doc).toContain("OFFLINE_MOCK_RPC=true");
    expect(doc).toContain("Single Payment");
    expect(doc).toContain("Batch Payment");
    expect(doc).toContain("Escrow Creation");
    expect(doc).toContain("Stream Creation");
  });

  it("configures OFFLINE_MOCK_RPC timeout acceleration in playwright.config.ts", () => {
    const config = read("playwright.config.ts");
    expect(config).toContain("OFFLINE_MOCK_RPC");
    expect(config).toContain("isOfflineMock");
  });
});
