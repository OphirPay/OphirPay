// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MultiWalletProvider, useWallet } from "@/hooks/useMultiWallet";
import * as walletsModule from "@/lib/wallets";
import * as stellarModule from "@/lib/stellar";
import * as clientAuthModule from "@/lib/client-auth";
import * as sessionModule from "@/lib/session";
import React from "react";

describe("MultiWalletProvider - Wallet Switch & State Preservation", () => {
  const freighterMock = {
    id: "freighter" as walletsModule.WalletId,
    name: "Freighter",
    description: "Freighter wallet",
    icon: "🦊",
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue({
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      network: "TESTNET",
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    signTransaction: vi.fn().mockResolvedValue("SIGNED_FREIGHTER_XDR"),
    signMessage: vi.fn().mockResolvedValue("SIG_FREIGHTER"),
    getAddress: vi.fn().mockResolvedValue("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    getNetwork: vi.fn().mockResolvedValue("TESTNET"),
    isConnected: vi.fn().mockResolvedValue(true),
  };

  const albedoMock = {
    id: "albedo" as walletsModule.WalletId,
    name: "Albedo",
    description: "Albedo wallet",
    icon: "☀️",
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue({
      publicKey: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
      network: "PUBLIC",
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    signTransaction: vi.fn().mockResolvedValue("SIGNED_ALBEDO_XDR"),
    signMessage: vi.fn().mockResolvedValue("SIG_ALBEDO"),
    getAddress: vi.fn().mockResolvedValue("GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU"),
    getNetwork: vi.fn().mockResolvedValue("PUBLIC"),
    isConnected: vi.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    vi.spyOn(walletsModule, "getWalletConnector").mockImplementation((id) => {
      if (id === "freighter") return freighterMock;
      if (id === "albedo") return albedoMock;
      return {
        id,
        name: id,
        description: "",
        icon: "",
        isAvailable: () => false,
        connect: async () => ({ publicKey: "", network: "" }),
        disconnect: async () => {},
        signTransaction: async () => "",
        getAddress: async () => null,
        getNetwork: async () => null,
        isConnected: async () => false,
      };
    });

    vi.spyOn(walletsModule, "getAvailableWallets").mockReturnValue([freighterMock, albedoMock]);
    vi.spyOn(stellarModule, "fetchXlmBalance").mockImplementation(async (pk) => {
      if (pk === freighterMock.connect.name || pk.startsWith("GBBD")) return "125.5000000";
      if (pk.startsWith("GACN")) return "4500.0000000";
      return "0";
    });

    vi.spyOn(clientAuthModule, "establishSession").mockResolvedValue(true);
    vi.spyOn(clientAuthModule, "revokeSession").mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("connects to Freighter, stores session, updates balance and activeWalletId", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MultiWalletProvider>{children}</MultiWalletProvider>
    );

    const { result } = renderHook(() => useWallet(), { wrapper });

    expect(result.current.wallet.connected).toBe(false);

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(result.current.wallet.connected).toBe(true);
    expect(result.current.wallet.publicKey).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(result.current.wallet.network).toBe("TESTNET");
    expect(result.current.wallet.activeWalletId).toBe("freighter");
    expect(result.current.wallet.balance).toBe("125.5000000");

    const savedSession = sessionModule.loadWalletSession();
    expect(savedSession).not.toBeNull();
    expect(savedSession?.walletId).toBe("freighter");
    expect(savedSession?.publicKey).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  });

  it("switches from Freighter to Albedo without leaking stale state", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MultiWalletProvider>{children}</MultiWalletProvider>
    );

    const { result } = renderHook(() => useWallet(), { wrapper });

    // 1. Connect Freighter
    await act(async () => {
      await result.current.connect("freighter");
    });
    expect(result.current.wallet.publicKey).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(result.current.wallet.balance).toBe("125.5000000");
    expect(result.current.wallet.network).toBe("TESTNET");

    // 2. Disconnect
    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.publicKey).toBeNull();
    expect(result.current.wallet.balance).toBeNull();
    expect(result.current.wallet.network).toBeNull();
    expect(result.current.wallet.activeWalletId).toBeNull();
    expect(sessionModule.loadWalletSession()).toBeNull();

    // 3. Connect Albedo
    await act(async () => {
      await result.current.connect("albedo");
    });

    expect(result.current.wallet.connected).toBe(true);
    expect(result.current.wallet.publicKey).toBe("GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU");
    expect(result.current.wallet.balance).toBe("4500.0000000");
    expect(result.current.wallet.network).toBe("PUBLIC");
    expect(result.current.wallet.activeWalletId).toBe("albedo");

    const savedSession = sessionModule.loadWalletSession();
    expect(savedSession?.walletId).toBe("albedo");
    expect(savedSession?.publicKey).toBe("GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU");
  });

  it("restores saved session on mount", async () => {
    sessionModule.saveWalletSession({
      publicKey: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
      network: "PUBLIC",
      walletId: "albedo",
      lastConnected: Date.now(),
    });
    localStorage.setItem("ophirpay-wallet-connected", "true");

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MultiWalletProvider>{children}</MultiWalletProvider>
    );

    const { result } = renderHook(() => useWallet(), { wrapper });

    await vi.waitFor(() => {
      expect(result.current.wallet.connected).toBe(true);
    });

    expect(result.current.wallet.activeWalletId).toBe("albedo");
    expect(result.current.wallet.publicKey).toBe("GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU");
    expect(result.current.wallet.network).toBe("PUBLIC");
    expect(result.current.wallet.balance).toBe("4500.0000000");
  });
});
