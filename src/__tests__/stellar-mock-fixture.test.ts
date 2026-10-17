// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import {
  SIGNER_A,
  MOCK_TX_FIXTURES,
  deterministicTxHash,
  signMockTransactionEnvelope,
  buildSorobanRpcResponse,
} from "../../e2e/helpers/stellar-mock";

describe("Deterministic mock Soroban RPC fixtures (#1298)", () => {
  it("provides deterministic fixtures for singlePayment, batchPayment, escrowCreation, and streamCreation", () => {
    const kinds = [
      "singlePayment",
      "batchPayment",
      "escrowCreation",
      "streamCreation",
    ] as const;

    for (const kind of kinds) {
      const fixture = MOCK_TX_FIXTURES[kind];
      expect(fixture.kind).toBe(kind);
      expect(fixture.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.ledger).toBeGreaterThan(40_000);

      // Verify returnValueXdr decodes cleanly as an ScVal u64
      const decodedScVal = xdr.ScVal.fromXDR(fixture.returnValueXdr, "base64");
      expect(decodedScVal.switch().name).toBe("scvU64");

      // Verify transactionDataXdr decodes cleanly as SorobanTransactionData
      const decodedTxData = xdr.SorobanTransactionData.fromXDR(
        fixture.transactionDataXdr,
        "base64",
      );
      expect(decodedTxData).toBeDefined();
    }
  });

  it("handles simulateTransaction, sendTransaction, getTransaction, and getLedgerEntries deterministically", () => {
    const fixture = MOCK_TX_FIXTURES.escrowCreation;

    const sim = buildSorobanRpcResponse("simulateTransaction", { fixture });
    expect(sim.latestLedger).toBe(fixture.ledger);
    expect(sim.transactionData).toBe(fixture.transactionDataXdr);
    expect(sim.results).toEqual([{ auth: [], xdr: fixture.returnValueXdr }]);

    const reverted = buildSorobanRpcResponse("simulateTransaction", {
      fixture,
      failSimulate: true,
      errorMessage: "Contract paused",
    });
    expect(reverted.error).toBe("Contract paused");

    const sent = buildSorobanRpcResponse("sendTransaction", { fixture });
    expect(sent.status).toBe("PENDING");
    expect(sent.hash).toBe(fixture.hash);

    const tx = buildSorobanRpcResponse("getTransaction", { fixture });
    expect(tx.status).toBe("SUCCESS");
    expect(tx.hash).toBe(fixture.hash);
    expect(tx.returnValue).toBe(fixture.returnValueXdr);

    const entries = buildSorobanRpcResponse("getLedgerEntries", {
      fixture,
      signer: SIGNER_A,
    }) as { entries: Array<{ key: string; xdr: string }> };
    expect(entries.entries).toHaveLength(1);
    expect(
      xdr.LedgerEntryData.fromXDR(entries.entries[0]!.xdr, "base64"),
    ).toBeDefined();
  });

  it("produces deterministic wallet signing responses and transaction hashes", () => {
    const h1 = deterministicTxHash("tx-envelope-1");
    const h2 = deterministicTxHash("tx-envelope-1");
    const h3 = deterministicTxHash("tx-envelope-2");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);

    const signed = signMockTransactionEnvelope("AAAAAgAAAAB...", SIGNER_A);
    expect(signed.signedTxXdr).toBe("AAAAAgAAAAB...");
    expect(signed.signerAddress).toBe(SIGNER_A);
    expect(signed.txHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
