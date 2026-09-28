// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, Operation, xdr } from "@stellar/stellar-sdk";

const prepared: { tx: unknown } = { tx: undefined };
const payer = Keypair.random().publicKey();
const payee = Keypair.random().publicKey();

vi.mock("@/lib/stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stellar")>();
  return {
    ...actual,
    getSorobanServer: () => ({
      getAccount: async (pk: string) => new Account(pk, "1"),
      prepareTransaction: async (tx: unknown) => {
        prepared.tx = tx;
        return tx;
      },
    }),
  };
});

import { idempotencyKeyToBytes, recordPaymentOnChain } from "@/lib/contracts";

/** Decode the args of the single invokeContract op in the last built tx. */
function lastInvokeArgs(): xdr.ScVal[] {
  const tx = prepared.tx as { operations: Operation.InvokeHostFunction[] };
  const fn = tx.operations[0].func;
  return fn.invokeContract().args();
}

async function record(idempotencyKey?: string | Uint8Array) {
  // Stop after the build step: signing is rejected so nothing is submitted.
  return recordPaymentOnChain({
    payer,
    payee,
    amountStroops: 1_000_000,
    txHash: "abc123",
    idempotencyKey,
    signTransaction: async () => {
      throw new Error("User rejected the request");
    },
  });
}

describe("idempotencyKeyToBytes", () => {
  it("hashes strings deterministically to 32 bytes", () => {
    const a = idempotencyKeyToBytes("horizon-tx-hash");
    expect(a.length).toBe(32);
    expect(idempotencyKeyToBytes("horizon-tx-hash").equals(a)).toBe(true);
    expect(idempotencyKeyToBytes("another-key").equals(a)).toBe(false);
  });

  it("passes exactly-32-byte arrays through unchanged", () => {
    const raw = new Uint8Array(32).fill(7);
    expect([...idempotencyKeyToBytes(raw)]).toEqual([...raw]);
  });

  it("rejects empty strings and wrong-length byte arrays", () => {
    expect(() => idempotencyKeyToBytes("")).toThrow(/empty/);
    expect(() => idempotencyKeyToBytes(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe("recordPaymentOnChain idempotency key", () => {
  beforeEach(() => {
    prepared.tx = undefined;
  });

  it("encodes the key as the trailing Bytes argument", async () => {
    await record("horizon-tx-hash");
    const args = lastInvokeArgs();
    expect(args).toHaveLength(7);
    expect(args[6].switch().name).toBe("scvBytes");
    expect(args[6].bytes().equals(idempotencyKeyToBytes("horizon-tx-hash"))).toBe(true);
  });

  it("sends the same key bytes for a retry and different bytes for a new key", async () => {
    await record("key-one");
    const first = lastInvokeArgs()[6].bytes();
    await record("key-one");
    const retry = lastInvokeArgs()[6].bytes();
    await record("key-two");
    const other = lastInvokeArgs()[6].bytes();
    expect(retry.equals(first)).toBe(true);
    expect(other.equals(first)).toBe(false);
  });

  it("encodes None (Void) when no key is provided", async () => {
    await record();
    const args = lastInvokeArgs();
    expect(args).toHaveLength(7);
    expect(args[6].switch().name).toBe("scvVoid");
  });

  it("reports FAILED instead of throwing for an invalid key", async () => {
    const result = await record(new Uint8Array(3));
    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/32 bytes/);
  });
});
