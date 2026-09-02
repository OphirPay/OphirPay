// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MultiWalletProvider, useWallet } from "@/hooks/useMultiWallet";

// ── Mocks ──────────────────────────────────────────────────────

const fetchXlmBalanceMock = vi.hoisted(() => vi.fn());
const establishSessionMock = vi.hoisted(() => vi.fn());
const revokeSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stellar", () => ({
  fetchXlmBalance: fetchXlmBalanceMock,
}));

vi.mock("@/lib/client-auth", () => ({
  establishSession: establishSessionMock,
  revokeSession: revokeSessionMock,
}));

const connectorMocks = vi.hoisted(() => ({
  freighter: {
    id: "freighter",
    name: "Freighter",
    isAvailable: vi.fn().mockReturnValue(true),
    isConnected: vi.fn().mockResolvedValue(false),
    getAddress: vi.fn().mockResolvedValue(null),
    getNetwork: vi.fn().mockResolvedValue("TESTNET"),
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
    signMessage: vi.fn(),
  },
}));

vi.mock("@/lib/wallets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/wallets")>("@/lib/wallets");
  return {
    ...actual,
    getWalletConnector: vi.fn().mockImplementation((id: string) => connectorMocks[id as keyof typeof connectorMocks]),
    getAvailableWallets: vi.fn().mockReturnValue([connectorMocks.freighter]),
  };
});

// ── Helpers ────────────────────────────────────────────────────
function createStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function TestConsumer() {
  const { wallet, isReconnecting, missingWallet, connect, disconnect } = useWallet();
  return (
    <div>
      <div data-testid="connected">{wallet.connected ? "yes" : "no"}</div>
      <div data-testid="reconnecting">{isReconnecting ? "yes" : "no"}</div>
      <div data-testid="missing">{missingWallet ?? "none"}</div>
      <div data-testid="publickey">{wallet.publicKey ?? "none"}</div>
      <button onClick={() => connect("freighter")}>Connect</button>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <MultiWalletProvider>
      <TestConsumer />
    </MultiWalletProvider>
  );
}

// ── Tests ──────────────────────────────────────────────────────

describe("MultiWalletProvider reconnect behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = createStorage();
    vi.stubGlobal("localStorage", storage);
    storage.clear();
    fetchXlmBalanceMock.mockResolvedValue("1000");
    establishSessionMock.mockResolvedValue(true);
  });

  afterEach(() => {
  });

  it("shows reconnecting state while restoring a stored wallet", async () => {
    localStorage.setItem("ophirpay-wallet-connected", "freighter");
    connectorMocks.freighter.isConnected.mockResolvedValueOnce(true);
    connectorMocks.freighter.getAddress.mockResolvedValueOnce("GABCDEF");

    renderProvider();

    expect(screen.getByTestId("reconnecting").textContent).toBe("yes");

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("yes");
    });
    expect(screen.getByTestId("publickey").textContent).toBe("GABCDEF");
  });

  it("reports a missing wallet when the stored extension is unavailable", async () => {
    localStorage.setItem("ophirpay-wallet-connected", "freighter");
    connectorMocks.freighter.isAvailable.mockReturnValueOnce(false);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("missing").textContent).toBe("freighter");
    });
    expect(screen.getByTestId("connected").textContent).toBe("no");
  });

  it("stores the wallet id on connect and clears it on disconnect", async () => {
    connectorMocks.freighter.connect.mockResolvedValueOnce({
      publicKey: "GCONNECT",
      network: "TESTNET",
    });

    renderProvider();
    screen.getByText("Connect").click();

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("yes");
    });
    expect(localStorage.getItem("ophirpay-wallet-connected")).toBe("freighter");

    screen.getByText("Disconnect").click();
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("no");
    });
    expect(localStorage.getItem("ophirpay-wallet-connected")).toBeNull();
  });

  it("retries balance fetch with backoff before giving up", async () => {
    localStorage.setItem("ophirpay-wallet-connected", "freighter");
    connectorMocks.freighter.isConnected.mockResolvedValueOnce(true);
    connectorMocks.freighter.getAddress.mockResolvedValueOnce("GRETRY");
    fetchXlmBalanceMock
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("500");

    renderProvider();

    await waitFor(() => {
      expect(fetchXlmBalanceMock).toHaveBeenCalledTimes(3);
    }, { timeout: 10000 });
  }, { timeout: 10000 });
});
