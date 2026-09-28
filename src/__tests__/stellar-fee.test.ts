// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, TransactionBuilder, Account } from "@stellar/stellar-sdk";
import * as stellar from "@/lib/stellar";

const mockLoadAccount = vi.fn();
const mockFetchBaseFee = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class FakeServer {
    constructor(..._args: unknown[]) {}
    loadAccount = mockLoadAccount;
    fetchBaseFee = mockFetchBaseFee;
  }
  return { ...actual, Horizon: { ...actual.Horizon, Server: FakeServer } };
});

const source = Keypair.random().publicKey();
const dest = Keypair.random().publicKey();
const dest2 = Keypair.random().publicKey();

const feeOf = (xdr: string) => TransactionBuilder.fromXDR(xdr, stellar.NETWORK_PASSPHRASE).fee;

describe("transaction builders honour the recommended fee (#825)", () => {
  beforeEach(() => {
    mockLoadAccount.mockImplementation(async () => new Account(source, "1"));
    mockFetchBaseFee.mockResolvedValue(100);
    mockFetchBaseFee.mockClear();
  });

  it("buildPaymentTx signs exactly the per-op fee it was given", async () => {
    const res = await stellar.buildPaymentTx({
      sourcePublicKey: source,
      destination: dest,
      amount: "1",
      fee: "250",
    });
    expect(feeOf(res.xdr)).toBe("250");
    expect(res.fee).toBe("250");
    expect(mockFetchBaseFee).not.toHaveBeenCalled();
  });

  it("charges the per-op fee for every operation of a sponsored payment", async () => {
    const res = await stellar.buildPaymentTx({
      sourcePublicKey: source,
      destination: dest,
      amount: "1",
      sponsorCreate: true,
      fee: "250",
    });
    expect(res.fee).toBe("500");
    expect(feeOf(res.xdr)).toBe("500");
  });

  it("buildBatchPaymentTx multiplies the per-op fee by the recipient count", async () => {
    const res = await stellar.buildBatchPaymentTx({
      sourcePublicKey: source,
      recipients: [
        { address: dest, amount: "1" },
        { address: dest2, amount: "2" },
        { address: dest, amount: "3" },
      ],
      fee: "300",
    });
    expect(res.fee).toBe("900");
    expect(feeOf(res.xdr)).toBe("900");
  });

  it("buildPathPaymentStrictSendTx uses the given fee and forwards it from buildPaymentTx", async () => {
    const res = await stellar.buildPaymentTx({
      sourcePublicKey: source,
      destination: dest,
      amount: "1",
      assetCode: "XLM",
      destAssetCode: "USDC",
      destAssetIssuer: Keypair.random().publicKey(),
      destMin: "0.9",
      fee: "400",
    });
    expect(res.fee).toBe("400");
    expect(feeOf(res.xdr)).toBe("400");
  });

  it("falls back to Horizon's base fee when no fee is supplied", async () => {
    mockFetchBaseFee.mockResolvedValue(120);
    const res = await stellar.buildPaymentTx({ sourcePublicKey: source, destination: dest, amount: "1" });
    expect(res.fee).toBe("120");
    expect(mockFetchBaseFee).toHaveBeenCalledTimes(1);
  });
});
