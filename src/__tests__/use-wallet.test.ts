// SPDX-License-Identifier: MIT
//
// useWallet — reconnection on session resume.
//
// After a page refresh the provider must restore the connection on its own when
// a valid session exists, and must stay disconnected (with no server session
// opened) when the stored session is expired, invalid or rejected by the
// wallet. The wallet extension boundary and the session API are mocked; the
// real `@/lib/session` storage helpers run against jsdom's localStorage.

import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MultiWalletProvider, useWallet } from "@/hooks/useMultiWallet";
import { loadWalletSession, saveWalletSession } from "@/lib/session";

const TEST_PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SESSION_KEY = "ophirpay-wallet-session";

const mocks = vi.hoisted(() => ({
  connector: {
    id: "freighter",
    name: "Freighter",
    isAvailable: vi.fn(),
    isConnected: vi.fn(),
    getAddress: vi.fn(),
    getNetwork: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    signMessage: vi.fn(),
  },
}));

vi.mock("@/lib/wallets", () => ({
  WALLET_REGISTRY: [],
  getWalletConnector: vi.fn(() => mocks.connector),
  getAvailableWallets: vi.fn(() => [mocks.connector]),
  setActiveWalletId: vi.fn(),
  getActiveWalletId: vi.fn(() => null),
  getActiveWalletConnector: vi.fn(() => mocks.connector),
}));

vi.mock("@/lib/stellar", () => ({
  fetchXlmBalance: vi.fn().mockResolvedValue("10.0000000"),
}));

vi.mock("@/lib/client-auth", () => ({
  establishSession: vi.fn().mockResolvedValue(true),
  revokeSession: vi.fn().mockResolvedValue(undefined),
}));

import { establishSession } from "@/lib/client-auth";
import { setActiveWalletId } from "@/lib/wallets";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(MultiWalletProvider, null, children);

function storeSession(lastConnected: number): void {
  saveWalletSession({
    publicKey: TEST_PUBLIC_KEY,
    network: "TESTNET",
    lastConnected,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();

  mocks.connector.isAvailable.mockReturnValue(true);
  mocks.connector.isConnected.mockResolvedValue(true);
  mocks.connector.getAddress.mockResolvedValue(TEST_PUBLIC_KEY);
  mocks.connector.getNetwork.mockResolvedValue("TESTNET");
  vi.mocked(establishSession).mockResolvedValue(true);
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useWallet — reconnection on session resume", () => {
  it("starts disconnected before the resume check completes", () => {
    storeSession(Date.now());
    mocks.connector.isConnected.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useWallet(), { wrapper });

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.publicKey).toBeNull();
  });

  it("reconnects seamlessly when a valid session exists in storage", async () => {
    storeSession(Date.now());
    expect(loadWalletSession()?.publicKey).toBe(TEST_PUBLIC_KEY);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.wallet.connected).toBe(true));

    expect(result.current.wallet.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.wallet.network).toBe("TESTNET");
    expect(result.current.wallet.activeWalletId).toBe("freighter");
    expect(setActiveWalletId).toHaveBeenCalledWith("freighter");
  });

  it("restores the server-side session for API authorization", async () => {
    storeSession(Date.now());

    renderHook(() => useWallet(), { wrapper });

    await waitFor(() =>
      expect(establishSession).toHaveBeenCalledWith(TEST_PUBLIC_KEY, "TESTNET")
    );
  });

  it("does not prompt the user to connect again (no connect() call)", async () => {
    storeSession(Date.now());

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.wallet.connected).toBe(true));
    expect(mocks.connector.connect).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("loads the balance after resuming", async () => {
    storeSession(Date.now());

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(result.current.wallet.balance).toBe("10.0000000"));
    expect(result.current.wallet.balanceLoading).toBe(false);
  });
});

describe("useWallet — expired or invalid sessions", () => {
  it("treats a stored session older than 24h as expired and clears it", () => {
    storeSession(Date.now() - 25 * 60 * 60 * 1000);

    expect(loadWalletSession()).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("treats a corrupted stored session as missing", () => {
    window.localStorage.setItem(SESSION_KEY, "{not-json");

    expect(loadWalletSession()).toBeNull();
  });

  it("stays disconnected when the wallet reports no active session", async () => {
    storeSession(Date.now() - 25 * 60 * 60 * 1000);
    mocks.connector.isConnected.mockResolvedValue(false);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(mocks.connector.isConnected).toHaveBeenCalled());

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.publicKey).toBeNull();
    expect(establishSession).not.toHaveBeenCalled();
    expect(setActiveWalletId).not.toHaveBeenCalled();
  });

  it("stays disconnected when no address can be restored", async () => {
    storeSession(Date.now());
    mocks.connector.getAddress.mockResolvedValue("");

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(mocks.connector.getAddress).toHaveBeenCalled());

    expect(result.current.wallet.connected).toBe(false);
    expect(establishSession).not.toHaveBeenCalled();
  });

  it("stays disconnected when the wallet throws during resume", async () => {
    storeSession(Date.now());
    mocks.connector.isConnected.mockRejectedValue(new Error("wallet locked"));

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(mocks.connector.isConnected).toHaveBeenCalled());

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.activeWalletId).toBeNull();
    expect(establishSession).not.toHaveBeenCalled();
  });

  it("stays disconnected when no wallet extension is available", async () => {
    storeSession(Date.now());
    mocks.connector.isAvailable.mockReturnValue(false);

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => expect(mocks.connector.isAvailable).toHaveBeenCalled());

    expect(result.current.wallet.connected).toBe(false);
    expect(mocks.connector.isConnected).not.toHaveBeenCalled();
  });
});
