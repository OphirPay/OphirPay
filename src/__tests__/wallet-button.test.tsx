// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletButton } from "@/components/WalletButton";

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: false,
      publicKey: null,
      network: null,
      balance: null,
      balanceLoading: false,
      activeWalletId: null,
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
    availableWallets: [],
  }),
}));

describe("WalletButton", () => {
  it("renders the Connect Wallet button when no wallet is connected", () => {
    render(<WalletButton />);
    expect(
      screen.getByRole("button", { name: /connect wallet/i })
    ).toBeInTheDocument();
  });

  it("shows a Freighter install tooltip when the connect button is hovered", async () => {
    const user = userEvent.setup();
    render(<WalletButton />);
    const button = screen.getByRole("button", { name: /connect wallet/i });

    await user.hover(button);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Install Freighter wallet extension"
    );
  });

  it("hides the tooltip when the pointer leaves the connect button", async () => {
    const user = userEvent.setup();
    render(<WalletButton />);
    const button = screen.getByRole("button", { name: /connect wallet/i });

    await user.hover(button);
    await screen.findByRole("tooltip");

    await user.unhover(button);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
