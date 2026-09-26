// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

const loadAccount = vi.fn();

vi.mock("@/lib/stellar", () => ({
  getHorizonServer: () => ({ loadAccount }),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

import { buildTrustlineTransaction, getTrustlineMessage } from "@/lib/trustline";

describe("trustline setup transaction", () => {
  const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  let publicKey: string;

  beforeEach(() => {
    publicKey = Keypair.random().publicKey();
    loadAccount.mockResolvedValue(new Account(publicKey, "0"));
  });

  it("builds a memo-free ChangeTrust for the selected issuer and standard maximum limit", async () => {
    const { xdr } = await buildTrustlineTransaction(publicKey, "USDC", issuer);
    const transaction = TransactionBuilder.fromXDR(xdr, "Test SDF Network ; September 2015");
    const operation = transaction.operations[0] as {
      type: string;
      asset: { code: string; issuer: string };
      limit: string;
    };

    expect(operation.type).toBe("changeTrust");
    expect(operation.asset.code).toBe("USDC");
    expect(operation.asset.issuer).toBe(issuer);
    expect(operation.limit).toBe("922337203685.4775807");
    expect(transaction.memo.type).toBe("none");
  });

  it("uses an explicitly supplied trustline limit", async () => {
    const { xdr } = await buildTrustlineTransaction(publicKey, "USDC", issuer, "1000");
    const transaction = TransactionBuilder.fromXDR(xdr, "Test SDF Network ; September 2015");
    expect((transaction.operations[0] as { limit: string }).limit).toBe("1000");
  });
});

describe("trustline state messaging", () => {
  it("gives distinct guidance for missing, unauthorized, and frozen trustlines", () => {
    expect(getTrustlineMessage("missing", "USDC")).toMatch(/set up a trustline/i);
    expect(getTrustlineMessage("unauthorized", "USDC")).toMatch(/not authorized/i);
    expect(getTrustlineMessage("frozen", "USDC")).toMatch(/frozen/i);
  });
});