// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadAccount, submitTransaction, buildTrustlineTransaction, checkTrustline, getActiveWalletConnector, fromXDR } =
  vi.hoisted(() => ({
    loadAccount: vi.fn(),
    submitTransaction: vi.fn(),
    buildTrustlineTransaction: vi.fn(),
    checkTrustline: vi.fn(),
    getActiveWalletConnector: vi.fn(),
    fromXDR: vi.fn(() => ({ envelope: "tx" })),
  }));

vi.mock("@/lib/stellar", () => ({
  getHorizonServer: () => ({ loadAccount, submitTransaction }),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_NETWORK: "TESTNET",
}));

vi.mock("@/lib/trustline", () => ({
  buildTrustlineTransaction,
  checkTrustline,
  // Re-exported by the module under test, so it must exist on the mock.
  getTrustlineMessage: vi.fn(() => "message"),
}));

vi.mock("@/lib/wallets", () => ({ getActiveWalletConnector }));

vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR },
}));

import { createTrustline, TrustlineWalletError } from "@/lib/stellar-transactions";

const PUBLIC_KEY = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

beforeEach(() => {
  vi.clearAllMocks();
  buildTrustlineTransaction.mockResolvedValue({ xdr: "unsigned-xdr" });
  submitTransaction.mockResolvedValue({ hash: "abc" });
  checkTrustline.mockResolvedValue({
    assetCode: "USDC",
    assetIssuer: ISSUER,
    hasTrustline: true,
    state: "authorized",
  });
  getActiveWalletConnector.mockReturnValue({
    signTransaction: vi.fn().mockResolvedValue("signed-xdr"),
  });
});

describe("createTrustline (issue #1384)", () => {
  it("refuses to build anything when no wallet can sign", async () => {
    getActiveWalletConnector.mockReturnValue(null);

    await expect(createTrustline(PUBLIC_KEY, "USDC", ISSUER)).rejects.toThrow(
      TrustlineWalletError,
    );
    expect(buildTrustlineTransaction).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("builds, signs on the configured network, submits and re-reads the trustline", async () => {
    const signer = { signTransaction: vi.fn().mockResolvedValue("signed-xdr") };
    getActiveWalletConnector.mockReturnValue(signer);

    const info = await createTrustline(PUBLIC_KEY, "USDC", ISSUER);

    expect(buildTrustlineTransaction).toHaveBeenCalledWith(
      PUBLIC_KEY,
      "USDC",
      ISSUER,
      undefined,
    );
    expect(signer.signTransaction).toHaveBeenCalledWith("unsigned-xdr", {
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    // The signed XDR is parsed with the *network* passphrase, not a hardcoded one.
    expect(fromXDR).toHaveBeenCalledWith(
      "signed-xdr",
      "Test SDF Network ; September 2015",
    );
    expect(submitTransaction).toHaveBeenCalledWith({ envelope: "tx" });
    // Verification happens *after* submission — never assume a successful
    // submit means the trustline exists.
    expect(checkTrustline).toHaveBeenCalledWith(PUBLIC_KEY, "USDC", ISSUER);
    expect(info.state).toBe("authorized");
  });

  it("accepts an explicit signer so the flow is usable without an active wallet", async () => {
    getActiveWalletConnector.mockReturnValue(null);
    const signer = { signTransaction: vi.fn().mockResolvedValue("signed-xdr") };

    await createTrustline(PUBLIC_KEY, "EURC", ISSUER, { signer, limit: "1000" });

    expect(buildTrustlineTransaction).toHaveBeenCalledWith(
      PUBLIC_KEY,
      "EURC",
      ISSUER,
      "1000",
    );
    expect(submitTransaction).toHaveBeenCalled();
  });

  it("does not submit when the user rejects the wallet prompt", async () => {
    const signer = {
      signTransaction: vi.fn().mockRejectedValue(new Error("User declined")),
    };
    getActiveWalletConnector.mockReturnValue(signer);

    await expect(createTrustline(PUBLIC_KEY, "USDC", ISSUER)).rejects.toThrow(
      "User declined",
    );
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(checkTrustline).not.toHaveBeenCalled();
  });

  it("reports a trustline that exists but is not yet authorized by the issuer", async () => {
    checkTrustline.mockResolvedValue({
      assetCode: "USDC",
      assetIssuer: ISSUER,
      hasTrustline: true,
      state: "unauthorized",
    });

    const info = await createTrustline(PUBLIC_KEY, "USDC", ISSUER);

    // A successful submit must not be reported as a usable trustline.
    expect(info.state).toBe("unauthorized");
    expect(info.hasTrustline).toBe(true);
  });

  it("surfaces a Horizon submission rejection to the caller", async () => {
    submitTransaction.mockRejectedValue(new Error("tx_insufficient_balance"));

    await expect(createTrustline(PUBLIC_KEY, "USDC", ISSUER)).rejects.toThrow(
      "tx_insufficient_balance",
    );
  });
});
