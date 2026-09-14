// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WalletSelector } from "@/components/WalletSelector";

const WALLET_IDS = ["freighter", "albedo", "xbull"] as const;

function renderSelector(props?: Partial<Parameters<typeof WalletSelector>[0]>) {
  return render(
    <WalletSelector
      availableWallets={[...WALLET_IDS]}
      onSelect={vi.fn()}
      isConnecting={false}
      onClose={vi.fn()}
      {...props}
    />
  );
}

describe("WalletSelector", () => {
  it("renders as a modal dialog with the wallet list", () => {
    renderSelector();
    expect(screen.getByRole("dialog", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.getByText("Freighter")).toBeInTheDocument();
    expect(screen.getByText("Albedo")).toBeInTheDocument();
    expect(screen.getByText("xBull")).toBeInTheDocument();
  });

  it("marks available wallets as Installed and others as Not found", () => {
    renderSelector({ availableWallets: ["freighter"] });
    expect(screen.getByText("Installed")).toBeInTheDocument();
    // Albedo/xBull are not available in this render
    expect(screen.getAllByText("Not found").length).toBeGreaterThan(0);
  });

  it("calls onSelect when an available wallet is clicked", () => {
    const onSelect = vi.fn();
    renderSelector({ onSelect });
    fireEvent.click(screen.getByRole("button", { name: /freighter/i }));
    expect(onSelect).toHaveBeenCalledWith("freighter");
  });

  it("does not call onSelect for unavailable wallets", () => {
    const onSelect = vi.fn();
    renderSelector({ availableWallets: [], onSelect });
    const unavailable = screen.getByRole("button", { name: /freighter/i });
    expect(unavailable).toBeDisabled();
    fireEvent.click(unavailable);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the connection error when provided", () => {
    renderSelector({ error: "Freighter wallet not installed." });
    expect(screen.getByText("Freighter wallet not installed.")).toBeInTheDocument();
  });

  it("closes on Escape (native keydown)", () => {
    const onClose = vi.fn();
    renderSelector({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger element on close via Escape", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Connect
          </button>
          {open && (
            <WalletSelector
              availableWallets={[...WALLET_IDS]}
              onSelect={vi.fn()}
              isConnecting={false}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /connect/i });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("dialog").querySelector('[tabindex="-1"]')).toHaveFocus()
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("traps Tab focus within the dialog", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Outside button
          </button>
          {open && (
            <WalletSelector
              availableWallets={[...WALLET_IDS]}
              onSelect={vi.fn()}
              isConnecting={false}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /outside button/i }));
    await waitFor(() =>
      expect(screen.getByRole("dialog").querySelector('[tabindex="-1"]')).toHaveFocus()
    );

    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});
