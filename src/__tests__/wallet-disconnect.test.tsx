// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MultiWalletProvider, useWallet } from "@/hooks/useMultiWallet";
import { WalletButton } from "@/components/WalletButton";
import TreasuryDashboard from "@/app/(dashboard)/page";
import { fetchXlmBalance } from "@/lib/stellar";

// ── Mocks ──────────────────────────────────────────────────────
//
// The connector is hoisted so individual tests can reconfigure its
// methods (e.g. hold a balance fetch or a disconnect open).

const mocks = vi.hoisted(() => {
  const TEST_PUBLIC_KEY =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const connector = {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension wallet for Stellar",
    icon: "🦊",
    isAvailable: () => true,
    connect: vi.fn().mockResolvedValue({
      publicKey: TEST_PUBLIC_KEY,
      network: "TESTNET",
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    signTransaction: vi.fn().mockResolvedValue("xdr"),
    signMessage: vi.fn().mockResolvedValue("c2lnbmF0dXJl"),
    getAddress: vi.fn().mockResolvedValue(TEST_PUBLIC_KEY),
    getNetwork: vi.fn().mockResolvedValue("TESTNET"),
    // Not connected on mount — prevents the provider's auto-reconnect
    // effect from connecting before the test drives the UI.
    isConnected: vi.fn().mockResolvedValue(false),
  };
  return { connector, TEST_PUBLIC_KEY };
});

vi.mock("@/lib/wallets", () => ({
  WALLET_REGISTRY: [
    {
      id: "freighter",
      name: "Freighter",
      description: "Browser extension wallet for Stellar",
      icon: "🦊",
      priority: 1,
    },
  ],
  getWalletConnector: () => mocks.connector,
  getAvailableWallets: () => [mocks.connector],
  setActiveWalletId: vi.fn(),
  getActiveWalletId: () => null,
  getActiveWalletConnector: () => mocks.connector,
}));

vi.mock("@/lib/stellar", () => ({
  fetchXlmBalance: vi.fn(),
  getAccountExplorerUrl: () => "https://stellar.expert/explorer/testnet/account/x",
  XLM_STROOPS: 1e7,
  STELLAR_NETWORK: "TESTNET",
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({ payments: [], total: 0 }),
}));

vi.mock("@/lib/client-auth", () => ({
  establishSession: vi.fn().mockResolvedValue(true),
  revokeSession: vi.fn().mockResolvedValue(undefined),
}));

// ── Harness ────────────────────────────────────────────────────

/** Reads provider-level state so tests can assert it, not just the UI. */
function StateProbe() {
  const { wallet } = useWallet();
  return (
    <div>
      <span data-testid="probe-connected">{String(wallet.connected)}</span>
      <span data-testid="probe-balance">{wallet.balance ?? "null"}</span>
      <span data-testid="probe-publicKey">{wallet.publicKey ?? "null"}</span>
    </div>
  );
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MultiWalletProvider>
        <StateProbe />
        <WalletButton />
        <TreasuryDashboard />
      </MultiWalletProvider>
    </QueryClientProvider>
  );
}

/** Connect through the real header UI: Connect Wallet → Freighter. */
async function connectFreighter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /connect wallet/i }));
  await user.click(await screen.findByRole("button", { name: /freighter/i }));
  await screen.findByRole("button", { name: "Disconnect wallet" });
}

// ── Tests ──────────────────────────────────────────────────────

describe("wallet disconnect clears cached balance", () => {
  beforeEach(() => {
    vi.mocked(fetchXlmBalance).mockReset();
    vi.mocked(fetchXlmBalance).mockResolvedValue("123.4500000");
    mocks.connector.connect.mockResolvedValue({
      publicKey: mocks.TEST_PUBLIC_KEY,
      network: "TESTNET",
    });
    mocks.connector.disconnect.mockResolvedValue(undefined);
    mocks.connector.isConnected.mockResolvedValue(false);
  });

  it("renders a placeholder while disconnected", async () => {
    renderApp();

    expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");
    // Dashboard stat card shows the connect placeholder once the on-chain
    // query settles (the stats grid is behind a loading skeleton).
    expect(await screen.findByText("Connect wallet")).toBeInTheDocument();
    expect(screen.queryByText("123.45 XLM")).toBeNull();
  });

  it("clears the cached balance across all consumers on disconnect", async () => {
    const user = userEvent.setup();
    renderApp();

    // Connect and wait for the balance to be cached and rendered.
    await connectFreighter(user);
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    await waitFor(() =>
      expect(screen.getByTestId("probe-balance")).toHaveTextContent("123.4500000"),
    );
    // Header chip + dashboard "Your Accounts" card both render the balance.
    expect((await screen.findAllByText("123.45 XLM")).length).toBeGreaterThanOrEqual(2);

    // Disconnect via the header.
    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));

    // Provider-level state fully reset (balance/publicKey back to null).
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");
    expect(screen.getByTestId("probe-publicKey")).toHaveTextContent("null");

    // Dashboard renders the placeholder immediately — no stale balance.
    expect(screen.queryByText("123.45 XLM")).toBeNull();
    expect(await screen.findByText("Connect wallet")).toBeInTheDocument();
  });

  it("does not repopulate the cache when an in-flight balance fetch resolves after disconnect", async () => {
    const user = userEvent.setup();
    renderApp();

    let resolveBalance!: (value: string) => void;
    vi.mocked(fetchXlmBalance).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveBalance = resolve;
        }),
    );

    // Connect — the balance fetch stays pending.
    await connectFreighter(user);
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");

    // Disconnect while the fetch is still in flight.
    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");

    // The stale response arrives AFTER disconnect — it must be ignored.
    // Flush the continuation deterministically so this assertion can't pass
    // merely because the stale update hasn't committed yet.
    resolveBalance("999.9900000");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");
    expect(screen.queryByText("999.99 XLM")).toBeNull();
    expect(await screen.findByText("Connect wallet")).toBeInTheDocument();
  });

  it("resets the UI immediately while async disconnect cleanup is still pending", async () => {
    const user = userEvent.setup();
    renderApp();

    await connectFreighter(user);
    await waitFor(() =>
      expect(screen.getByTestId("probe-balance")).toHaveTextContent("123.4500000"),
    );

    // Hold the wallet's disconnect open — the UI must still reset now.
    let resolveDisconnect!: () => void;
    mocks.connector.disconnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDisconnect = resolve;
        }),
    );

    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));

    await waitFor(() =>
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");
    expect(screen.getByTestId("probe-publicKey")).toHaveTextContent("null");
    expect(screen.queryByText("123.45 XLM")).toBeNull();
    expect(await screen.findByText("Connect wallet")).toBeInTheDocument();

    // Once cleanup finishes, the balance stays cleared.
    resolveDisconnect();
    await waitFor(() =>
      expect(screen.getByTestId("probe-balance")).toHaveTextContent("null"),
    );
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
  });
});
