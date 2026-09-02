// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider, useWallet } from "@/hooks/useFreighter";
import type { FreighterAPI } from "@/types";
import { fetchXlmBalance } from "@/lib/stellar";

const TEST_PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function Harness() {
  const { wallet, connect, disconnect } = useWallet();
  return (
    <div>
      <span data-testid="freighter-connected">{String(wallet.connected)}</span>
      <span data-testid="freighter-balance">{wallet.balance ?? "null"}</span>
      <span data-testid="freighter-publicKey">{wallet.publicKey ?? "null"}</span>
      <button onClick={() => connect()}>Connect</button>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  );
}

vi.mock("@/lib/stellar", () => ({
  fetchXlmBalance: vi.fn(),
}));

describe("useFreighter — disconnect clears cached balance", () => {
  beforeEach(() => {
    vi.mocked(fetchXlmBalance).mockReset();
    vi.mocked(fetchXlmBalance).mockResolvedValue("42.5000000");
    (window as unknown as { freighter?: FreighterAPI }).freighter = {
      isConnected: vi.fn().mockResolvedValue(false),
      requestAccess: vi.fn().mockResolvedValue("granted"),
      getAddress: vi.fn().mockResolvedValue(TEST_PUBLIC_KEY),
      getNetwork: vi.fn().mockResolvedValue("TESTNET"),
      getNetworkDetails: vi.fn().mockResolvedValue({
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
      signTransaction: vi.fn().mockResolvedValue("xdr"),
    } as unknown as FreighterAPI;
  });

  it("resets balance and account state to null on disconnect", async () => {
    const user = userEvent.setup();
    render(
      <WalletProvider>
        <Harness />
      </WalletProvider>
    );

    expect(screen.getByTestId("freighter-connected")).toHaveTextContent("false");
    expect(screen.getByTestId("freighter-balance")).toHaveTextContent("null");

    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.getByTestId("freighter-balance")).toHaveTextContent("42.5000000"),
    );
    expect(screen.getByTestId("freighter-connected")).toHaveTextContent("true");
    expect(screen.getByTestId("freighter-publicKey")).toHaveTextContent(
      TEST_PUBLIC_KEY,
    );

    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(screen.getByTestId("freighter-connected")).toHaveTextContent("false");
    expect(screen.getByTestId("freighter-balance")).toHaveTextContent("null");
    expect(screen.getByTestId("freighter-publicKey")).toHaveTextContent("null");
  });

  it("ignores a balance fetch that resolves after disconnect", async () => {
    const user = userEvent.setup();

    let resolveBalance!: (value: string) => void;
    vi.mocked(fetchXlmBalance).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveBalance = resolve;
        }),
    );

    render(
      <WalletProvider>
        <Harness />
      </WalletProvider>
    );

    await user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(screen.getByTestId("freighter-connected")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("freighter-balance")).toHaveTextContent("null");

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByTestId("freighter-connected")).toHaveTextContent("false");

    // The stale response arrives AFTER disconnect — it must be ignored.
    // Flush the continuation deterministically so this assertion can't pass
    // merely because the stale update hasn't committed yet.
    resolveBalance("999.9900000");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("freighter-balance")).toHaveTextContent("null");
    expect(screen.getByTestId("freighter-publicKey")).toHaveTextContent("null");
  });
});
