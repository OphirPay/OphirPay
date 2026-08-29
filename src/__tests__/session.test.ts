// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveWalletSession,
  loadWalletSession,
  clearWalletSession,
} from "@/lib/session";

describe("session.ts - Client Wallet Session Storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("saves and loads a valid wallet session", () => {
    const session = {
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      network: "TESTNET",
      walletId: "freighter" as const,
      lastConnected: Date.now(),
    };

    saveWalletSession(session);
    const loaded = loadWalletSession();

    expect(loaded).toEqual(session);
  });

  it("returns null when no session is present", () => {
    expect(loadWalletSession()).toBeNull();
  });

  it("expires and clears sessions older than 24 hours", () => {
    const expiredSession = {
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      network: "TESTNET",
      walletId: "freighter" as const,
      lastConnected: Date.now() - 86400001, // > 24 hours ago
    };

    saveWalletSession(expiredSession);
    expect(loadWalletSession()).toBeNull();
  });

  it("clears session and connected flags on clearWalletSession", () => {
    saveWalletSession({
      publicKey: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
      network: "PUBLIC",
      walletId: "albedo" as const,
      lastConnected: Date.now(),
    });
    localStorage.setItem("ophirpay-wallet-connected", "true");

    clearWalletSession();

    expect(loadWalletSession()).toBeNull();
    expect(localStorage.getItem("ophirpay-wallet-connected")).toBeNull();
  });
});
