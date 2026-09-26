// SPDX-License-Identifier: MIT
//
// Issue #712 — the wallet hooks (`useMultiWallet`, `useFreighter`) were
// excluded from coverage because the real implementations talk to browser
// wallet extensions that jsdom cannot provide. This suite mocks the extension
// boundary (`@/lib/wallets`, `window.freighter`, the balance reader and the
// session API) and exercises the provider state machines instead:
//
//   • mount auto-reconnect
//   • connect success / unavailable / rejection / session rollback
//   • disconnect cleanup + server-session revocation
//   • balance refresh guarding

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FreighterAPI } from "@/types";
import type { WalletId } from "@/lib/wallets";

import {
  MultiWalletProvider,
  useWallet as useMultiWallet,
} from "@/hooks/useMultiWallet";
import {
  WalletProvider,
  useWallet as useFreighterWallet,
  getFreighter,
} from "@/hooks/useFreighter";

// ── Mocks ──────────────────────────────────────────────────────

const TEST_PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const mocks = vi.hoisted(() => {
  const connector: {
    id: string;
    name: string;
    description: string;
    icon: string;
    isAvailable: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    signTransaction: ReturnType<typeof vi.fn>;
    signMessage?: ReturnType<typeof vi.fn>;
    getAddress: ReturnType<typeof vi.fn>;
    getNetwork: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
  } = {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension wallet for Stellar",
    icon: "🦊",
    isAvailable: vi.fn().mockReturnValue(true),
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn().mockResolvedValue("xdr"),
    signMessage: vi.fn().mockResolvedValue("c2lnbmF0dXJl"),
    getAddress: vi.fn(),
    getNetwork: vi.fn(),
    isConnected: vi.fn(),
  };
  return { connector };
});

vi.mock("@/lib/wallets", () => ({
  WALLET_REGISTRY: [],
  getWalletConnector: vi.fn(() => mocks.connector),
  getAvailableWallets: vi.fn(() => [mocks.connector]),
  setActiveWalletId: vi.fn(),
  getActiveWalletId: vi.fn(() => null),
  getActiveWalletConnector: vi.fn(() => mocks.connector),
}));

vi.mock("@/lib/stellar", () => ({
  fetchXlmBalance: vi.fn(),
}));

vi.mock("@/lib/client-auth", () => ({
  establishSession: vi.fn().mockResolvedValue(true),
  revokeSession: vi.fn().mockResolvedValue(undefined),
}));

import { fetchXlmBalance } from "@/lib/stellar";
import {
  establishSession,
  revokeSession,
} from "@/lib/client-auth";
import { setActiveWalletId } from "@/lib/wallets";

const multiWalletWrapper = ({ children }: { children: ReactNode }) => (
  <MultiWalletProvider>{children}</MultiWalletProvider>
);

const freighterWrapper = ({ children }: { children: ReactNode }) => (
  <WalletProvider>{children}</WalletProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();

  mocks.connector.isAvailable.mockReturnValue(true);
  mocks.connector.connect.mockResolvedValue({
    publicKey: TEST_PUBLIC_KEY,
    network: "TESTNET",
  });
  mocks.connector.disconnect.mockResolvedValue(undefined);
  mocks.connector.getAddress.mockResolvedValue(TEST_PUBLIC_KEY);
  mocks.connector.getNetwork.mockResolvedValue("TESTNET");
  mocks.connector.isConnected.mockResolvedValue(false);
  mocks.connector.signMessage = vi.fn().mockResolvedValue("c2lnbmF0dXJl");

  vi.mocked(fetchXlmBalance).mockReset();
  vi.mocked(fetchXlmBalance).mockResolvedValue("10.0000000");
  vi.mocked(establishSession).mockReset();
  vi.mocked(establishSession).mockResolvedValue(true);
  vi.mocked(revokeSession).mockReset();
  vi.mocked(revokeSession).mockResolvedValue(undefined);

  // Default: no legacy Freighter extension installed.
  delete (window as unknown as { freighter?: FreighterAPI }).freighter;
});

// ═══════════════════════════════════════════════════════════════
// useMultiWallet
// ═══════════════════════════════════════════════════════════════

describe("useMultiWallet", () => {
  it("throws when used outside a MultiWalletProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useMultiWallet())).toThrow(
      /useWallet must be used within a MultiWalletProvider/
    );
    spy.mockRestore();
  });

  it("exposes the available wallets detected on mount", async () => {
    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await waitFor(() =>
      expect(result.current.availableWallets).toEqual(["freighter" as WalletId])
    );
    expect(result.current.wallet.connected).toBe(false);
  });

  it("connects, registers the active wallet and loads the balance", async () => {
    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(result.current.wallet.connected).toBe(true);
    expect(result.current.wallet.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.wallet.activeWalletId).toBe("freighter");
    expect(setActiveWalletId).toHaveBeenCalledWith("freighter");
    await waitFor(() =>
      expect(result.current.wallet.balance).toBe("10.0000000")
    );
    expect(establishSession).toHaveBeenCalledWith(
      TEST_PUBLIC_KEY,
      "TESTNET",
      expect.any(Function)
    );
  });

  it("auto-reconnects to an already-connected wallet on mount", async () => {
    mocks.connector.isConnected.mockResolvedValue(true);

    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await waitFor(() =>
      expect(result.current.wallet.connected).toBe(true)
    );
    expect(result.current.wallet.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.wallet.activeWalletId).toBe("freighter");
    expect(establishSession).toHaveBeenCalledWith(TEST_PUBLIC_KEY, "TESTNET");
  });

  it("reports an error when the wallet is not installed", async () => {
    mocks.connector.isAvailable.mockReturnValue(false);

    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.error).toMatch(/is not available/);
    expect(result.current.isConnecting).toBe(false);
  });

  it("surfaces the connector's rejection message", async () => {
    mocks.connector.connect.mockRejectedValueOnce(new Error("User rejected"));

    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(result.current.error).toBe("User rejected");
    expect(result.current.wallet.connected).toBe(false);
  });

  it("rolls back when a signing wallet's server session is rejected", async () => {
    vi.mocked(establishSession).mockResolvedValue(false);

    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.connect("freighter");
    });

    // The wallet supported signMessage but the server rejected the proof, so
    // no half-connected state is left behind.
    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.publicKey).toBeNull();
    expect(result.current.error).toMatch(/rejected the session/);
    expect(setActiveWalletId).toHaveBeenCalledWith(null);
  });

  it("keeps the connection but warns when the wallet cannot sign messages", async () => {
    mocks.connector.signMessage = undefined;
    vi.mocked(establishSession).mockResolvedValue(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(result.current.wallet.connected).toBe(true);
    expect(result.current.error).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no signMessage support")
    );
    warn.mockRestore();
  });

  it("disconnects, clears state and revokes the server session", async () => {
    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.connect("freighter");
    });
    expect(result.current.wallet.connected).toBe(true);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.publicKey).toBeNull();
    expect(result.current.wallet.balance).toBeNull();
    expect(mocks.connector.disconnect).toHaveBeenCalledTimes(1);
    expect(revokeSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a balance refresh when no wallet is connected", async () => {
    const { result } = renderHook(() => useMultiWallet(), {
      wrapper: multiWalletWrapper,
    });

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(fetchXlmBalance).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// useFreighter (legacy single-wallet provider)
// ═══════════════════════════════════════════════════════════════

describe("useFreighter", () => {
  const installFreighter = (overrides: Partial<FreighterAPI> = {}) => {
    const api = {
      isConnected: vi.fn().mockResolvedValue(false),
      requestAccess: vi.fn().mockResolvedValue("granted"),
      getAddress: vi.fn().mockResolvedValue(TEST_PUBLIC_KEY),
      getNetwork: vi.fn().mockResolvedValue("TESTNET"),
      getNetworkDetails: vi.fn().mockResolvedValue({
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
      signTransaction: vi.fn().mockResolvedValue("xdr"),
      ...overrides,
    } as unknown as FreighterAPI;
    (window as unknown as { freighter?: FreighterAPI }).freighter = api;
    return api;
  };

  it("getFreighter returns undefined when the extension is absent", () => {
    expect(getFreighter()).toBeUndefined();
  });

  it("throws when used outside a WalletProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useFreighterWallet())).toThrow(
      /useWallet must be used within a WalletProvider/
    );
    spy.mockRestore();
  });

  it("auto-detects an existing connection on mount", async () => {
    installFreighter({ isConnected: vi.fn().mockResolvedValue(true) });

    const { result } = renderHook(() => useFreighterWallet(), {
      wrapper: freighterWrapper,
    });

    await waitFor(() =>
      expect(result.current.wallet.connected).toBe(true)
    );
    expect(result.current.wallet.publicKey).toBe(TEST_PUBLIC_KEY);
    await waitFor(() =>
      expect(result.current.wallet.balance).toBe("10.0000000")
    );
  });

  it("errors when connecting without the extension installed", async () => {
    const { result } = renderHook(() => useFreighterWallet(), {
      wrapper: freighterWrapper,
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.error).toMatch(/not installed/);
  });

  it("connects through requestAccess and loads the balance", async () => {
    installFreighter();

    const { result } = renderHook(() => useFreighterWallet(), {
      wrapper: freighterWrapper,
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.wallet.connected).toBe(true);
    expect(result.current.wallet.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.wallet.network).toBe("TESTNET");
    await waitFor(() =>
      expect(result.current.wallet.balance).toBe("10.0000000")
    );
  });

  it("reports a rejected access request", async () => {
    installFreighter({
      requestAccess: vi.fn().mockRejectedValue(new Error("User denied")),
    });

    const { result } = renderHook(() => useFreighterWallet(), {
      wrapper: freighterWrapper,
    });

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.error).toBe("User denied");
    expect(result.current.wallet.connected).toBe(false);
  });

  it("disconnect resets state and clears the persisted connected flag", async () => {
    installFreighter();
    window.localStorage.setItem("ophirpay-wallet-connected", "1");

    const { result } = renderHook(() => useFreighterWallet(), {
      wrapper: freighterWrapper,
    });

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.wallet.connected).toBe(true);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.wallet.connected).toBe(false);
    expect(result.current.wallet.publicKey).toBeNull();
    expect(window.localStorage.getItem("ophirpay-wallet-connected")).toBeNull();
  });

  it("fetchBalance is a no-op while disconnected", async () => {
    installFreighter();

    const { result } = renderHook(() => useFreighterWallet(), {
      wrapper: freighterWrapper,
    });

    await act(async () => {
      await result.current.fetchBalance();
    });

    expect(fetchXlmBalance).not.toHaveBeenCalled();
  });
});
