// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MultiWalletProvider, useWallet } from "@/hooks/useMultiWallet";
import { WalletButton } from "@/components/WalletButton";
import TreasuryDashboard from "@/app/(dashboard)/page";
import { fetchXlmBalance } from "@/lib/stellar";
import { revokeSession } from "@/lib/client-auth";
import { formatAmount } from "@/lib/utils";

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
  const { wallet, setHasUnsavedWork } = useWallet();
  return (
    <div>
      <span data-testid="probe-connected">{String(wallet.connected)}</span>
      <span data-testid="probe-balance">{wallet.balance ?? "null"}</span>
      <span data-testid="probe-publicKey">{wallet.publicKey ?? "null"}</span>
      <button data-testid="probe-set-unsaved" onClick={() => setHasUnsavedWork(true)}>
        Set Unsaved
      </button>
    </div>
  );
}

function renderApp(customQueryClient?: QueryClient) {
  const queryClient =
    customQueryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MultiWalletProvider>
          <StateProbe />
          <WalletButton />
          <TreasuryDashboard />
        </MultiWalletProvider>
      </QueryClientProvider>
    ),
    queryClient,
  };
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
    const { queryClient } = renderApp();
    const clearSpy = vi.spyOn(queryClient, "clear");

    // Connect and wait for the balance to be cached and rendered.
    await connectFreighter(user);
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    await waitFor(() =>
      expect(screen.getByTestId("probe-balance")).toHaveTextContent("123.4500000"),
    );
    // Header chip + dashboard "Your Accounts" card both render the balance.
    const formattedBalance = formatAmount(123.45, "XLM");
    expect((await screen.findAllByText(formattedBalance)).length).toBeGreaterThanOrEqual(2);

    // Disconnect via the header.
    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));

    // Provider-level state fully reset (balance/publicKey back to null).
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");
    expect(screen.getByTestId("probe-publicKey")).toHaveTextContent("null");

    // Dashboard renders the placeholder immediately — no stale balance.
    expect(screen.queryByText(formattedBalance)).toBeNull();
    expect(await screen.findByText("Connect wallet")).toBeInTheDocument();

    // QueryClient cache cleared and server session revoked
    expect(clearSpy).toHaveBeenCalled();
    expect(revokeSession).toHaveBeenCalled();
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
    expect(screen.queryByText(formatAmount(999.99, "XLM"))).toBeNull();
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
    expect(screen.queryByText(formatAmount(123.45, "XLM"))).toBeNull();
    expect(await screen.findByText("Connect wallet")).toBeInTheDocument();

    // Once cleanup finishes, the balance stays cleared.
    resolveDisconnect();
    await waitFor(() =>
      expect(screen.getByTestId("probe-balance")).toHaveTextContent("null"),
    );
    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
  });

  it("prompts warning dialog when user has unsaved draft payments and preserves state if canceled", async () => {
    const user = userEvent.setup();
    renderApp();

    await connectFreighter(user);
    await waitFor(() =>
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true"),
    );

    // Set unsaved work flag in provider
    await user.click(screen.getByTestId("probe-set-unsaved"));

    // Click disconnect button in header
    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));

    // Warning dialog appears
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Disconnect Wallet")).toBeInTheDocument();
    expect(
      screen.getByText(/You have unsaved draft payments or in-flight transactions/),
    ).toBeInTheDocument();

    // Wallet remains connected while dialog is open
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");

    // Click Cancel
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // Dialog is dismissed, wallet still connected
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
  });

  it("disconnects and purges draft payments when confirmed in warning dialog", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("ophirpay-draft-payment", JSON.stringify({ amount: "50", dest: "G..." }));
    const { queryClient } = renderApp();
    const clearSpy = vi.spyOn(queryClient, "clear");

    await connectFreighter(user);
    await waitFor(() =>
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true"),
    );

    // Click disconnect button in header
    await user.click(screen.getByRole("button", { name: "Disconnect wallet" }));

    // Warning dialog should appear because draft payment is present in storage
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Click confirm disconnect
    await user.click(screen.getByRole("button", { name: /disconnect anyway/i }));

    // Dialog closed and wallet disconnected
    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("probe-balance")).toHaveTextContent("null");
    expect(window.localStorage.getItem("ophirpay-draft-payment")).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
    expect(revokeSession).toHaveBeenCalled();
  });
});
