// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, TransactionBuilder, Account } from "@stellar/stellar-sdk";
import * as stellar from "@/lib/stellar";

const mockLoadAccount = vi.fn();
const mockFetchBaseFee = vi.fn();
const mockSubmitTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class FakeServer {
    constructor(..._args: unknown[]) {}
    loadAccount = mockLoadAccount;
    fetchBaseFee = mockFetchBaseFee;
    submitTransaction = mockSubmitTransaction;
  }
  return {
    ...actual,
    Horizon: { ...actual.Horizon, Server: FakeServer },
  };
});

const sourceKey = Keypair.random();
const destKey = Keypair.random();

function fakeAccount() {
  return new Account(sourceKey.publicKey(), "12345");
}

describe("accountExists", () => {
  beforeEach(() => {
    mockLoadAccount.mockResolvedValue(fakeAccount());
    mockFetchBaseFee.mockResolvedValue(100);
    mockSubmitTransaction.mockResolvedValue({ hash: "abc", successful: true });
  });

  it("returns true when the account is found", async () => {
    await expect(stellar.accountExists(destKey.publicKey())).resolves.toBe(true);
  });

  it("returns false when Horizon returns a 404 (account not found)", async () => {
    const notFound = Object.assign(new Error("Not found"), {
      response: { status: 404 },
    });
    mockLoadAccount.mockRejectedValue(notFound);
    await expect(stellar.accountExists(destKey.publicKey())).resolves.toBe(false);
  });

  it("rethrows unexpected errors", async () => {
    const boom = new Error("network down");
    mockLoadAccount.mockRejectedValue(boom);
    await expect(stellar.accountExists(destKey.publicKey())).rejects.toThrow(
      "network down"
    );
  });
});

describe("isAccountNotFound", () => {
  it("detects a 404 from the response status", () => {
    expect(
      stellar.isAccountNotFound({ response: { status: 404 } })
    ).toBe(true);
  });
  it("detects the NotFoundError name", () => {
    expect(stellar.isAccountNotFound({ name: "NotFoundError" })).toBe(true);
  });
  it("returns false for unrelated errors", () => {
    expect(stellar.isAccountNotFound(new Error("boom"))).toBe(false);
  });
});

describe("buildPaymentTx", () => {
  beforeEach(() => {
    mockLoadAccount.mockResolvedValue(fakeAccount());
    mockFetchBaseFee.mockResolvedValue(100);
  });

  it("builds a single payment operation without sponsorship", async () => {
    const { xdr } = await stellar.buildPaymentTx({
      sourcePublicKey: sourceKey.publicKey(),
      destination: destKey.publicKey(),
      amount: "10",
    });
    expect(typeof xdr).toBe("string");
    const rebuilt = TransactionBuilder.fromXDR(xdr, stellar.NETWORK_PASSPHRASE);
    expect(rebuilt.operations).toHaveLength(1);
    expect(rebuilt.operations[0].type).toBe("payment");
  });

  it("prepends a createAccount operation when sponsoring a new recipient", async () => {
    const { xdr } = await stellar.buildPaymentTx({
      sourcePublicKey: sourceKey.publicKey(),
      destination: destKey.publicKey(),
      amount: "10",
      sponsorCreate: true,
    });
    const rebuilt = TransactionBuilder.fromXDR(xdr, stellar.NETWORK_PASSPHRASE);
    type CreateAccountOp = {
      type: string;
      destination: string;
      startingBalance: string;
    };
    expect(rebuilt.operations).toHaveLength(2);
    expect(rebuilt.operations[0].type).toBe("createAccount");
    const createOp = rebuilt.operations[0] as unknown as CreateAccountOp;
    expect(Number(createOp.startingBalance)).toBe(
      Number(stellar.SPONSOR_MIN_STARTING_BALANCE)
    );
    expect(createOp.destination).toBe(destKey.publicKey());
    expect(rebuilt.operations[1].type).toBe("payment");
  });

  it("uses a custom starting balance when provided", async () => {
    const { xdr } = await stellar.buildPaymentTx({
      sourcePublicKey: sourceKey.publicKey(),
      destination: destKey.publicKey(),
      amount: "10",
      sponsorCreate: true,
      startingBalance: "2",
    });
    const rebuilt = TransactionBuilder.fromXDR(xdr, stellar.NETWORK_PASSPHRASE);
    type CreateAccountOp = {
      type: string;
      destination: string;
      startingBalance: string;
    };
    const createOp = rebuilt.operations[0] as unknown as CreateAccountOp;
    expect(Number(createOp.startingBalance)).toBe(2);
  });
});

describe("parseSubmissionError", () => {
  it("maps a structured op_underfunded result code", () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: {
              transaction: "tx_failed",
              operations: ["op_underfunded"],
            },
          },
        },
      },
    };
    expect(stellar.parseSubmissionError(err)).toMatch(/Insufficient funds/i);
  });

  it("maps tx_insufficient_balance", () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: { transaction: "tx_insufficient_balance" },
          },
        },
      },
    };
    expect(stellar.parseSubmissionError(err)).toMatch(/Insufficient balance/i);
  });

  it("falls back to scanning the raw message", () => {
    const err = new Error("something op_low_reserve happened");
    expect(stellar.parseSubmissionError(err)).toMatch(/minimum reserve/i);
  });

  it("returns a generic message for unknown errors", () => {
    const err = new Error("totally unknown issue");
    expect(stellar.parseSubmissionError(err)).toMatch(/totally unknown issue/);
  });
});
