import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { StatusAnnouncer } from "@/components/ui/StatusAnnouncer";
import { ARIA } from "@/lib/aria-labels";
import { WalletButton } from "@/components/WalletButton";
import { WalletSelector } from "@/components/WalletSelector";
import { MultiWalletProvider, useWallet as useMultiWallet } from "@/hooks/useMultiWallet";
import { WalletProvider as FreighterWalletProvider, useWallet as useFreighterWallet } from "@/hooks/useFreighter";

describe("StatusAnnouncer Component", () => {
  it("renders a polite live region with sr-only class by default", () => {
    render(<StatusAnnouncer message="Transaction submitted" />);
    const el = screen.getByTestId("status-announcer");

    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveAttribute("aria-atomic", "true");
    expect(el).toHaveClass("sr-only");
    expect(el).toHaveTextContent("Transaction submitted");
  });

  it("renders an assertive alert region when politeness is assertive", () => {
    render(
      <StatusAnnouncer
        message="Transaction failed"
        politeness="assertive"
      />
    );
    const el = screen.getByTestId("status-announcer");

    expect(el).toHaveAttribute("role", "alert");
    expect(el).toHaveAttribute("aria-live", "assertive");
    expect(el).toHaveAttribute("aria-atomic", "true");
    expect(el).toHaveTextContent("Transaction failed");
  });

  it("allows custom role and custom className override", () => {
    render(
      <StatusAnnouncer
        message="Processing log"
        role="log"
        className="custom-a11y-class"
        id="tx-log-announcer"
      />
    );
    const el = screen.getByTestId("status-announcer");

    expect(el).toHaveAttribute("role", "log");
    expect(el).toHaveAttribute("id", "tx-log-announcer");
    expect(el).toHaveClass("sr-only");
    expect(el).toHaveClass("custom-a11y-class");
  });

  it("handles null and empty messages gracefully while preserving live region in DOM", () => {
    const { rerender } = render(<StatusAnnouncer message={null} />);
    const el = screen.getByTestId("status-announcer");

    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("");

    rerender(<StatusAnnouncer message="Now updated" />);
    expect(el).toHaveTextContent("Now updated");
  });
});

describe("ARIA labels and announcement constants", () => {
  it("defines all required transaction status announcement strings", () => {
    expect(ARIA.WALLET_CONNECTING).toBe("Connecting to wallet...");
    expect(ARIA.WALLET_CONNECTED).toBe("Wallet connected successfully");
    expect(ARIA.WALLET_DISCONNECTED).toBe("Wallet disconnected");
    expect(ARIA.WALLET_CONNECTION_FAILED).toBe("Wallet connection failed");
    expect(ARIA.TRANSACTION_PREPARING).toBe("Preparing transaction...");
    expect(ARIA.TRANSACTION_SIGNING).toBe("Waiting for wallet signature...");
    expect(ARIA.TRANSACTION_SUBMITTING).toBe("Submitting transaction to Stellar network...");
    expect(ARIA.TRANSACTION_CONFIRMED).toBe("Transaction confirmed successfully");
    expect(ARIA.TRANSACTION_FAILED).toBe("Transaction failed");
  });
});

describe("WalletSelector live region announcements", () => {
  it("announces connecting status when connection is in progress", () => {
    render(
      <WalletSelector
        availableWallets={["freighter"]}
        onSelect={() => {}}
        isConnecting={true}
        connectingWallet="freighter"
        onClose={() => {}}
      />
    );

    const announcer = screen.getByTestId("status-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Connecting to wallet... (freighter)");
  });

  it("announces error aggressively when an error is present", () => {
    render(
      <WalletSelector
        availableWallets={["freighter"]}
        onSelect={() => {}}
        isConnecting={false}
        error="Ledger device not found"
        onClose={() => {}}
      />
    );

    const announcer = screen.getByTestId("status-announcer");
    expect(announcer).toHaveAttribute("aria-live", "assertive");
    expect(announcer).toHaveAttribute("role", "alert");
    expect(announcer).toHaveTextContent("Error: Ledger device not found");
  });
});

describe("WalletButton live region integration", () => {
  it("renders status announcer in unauthenticated state", () => {
    render(
      <MultiWalletProvider>
        <WalletButton />
      </MultiWalletProvider>
    );

    const announcer = screen.getByTestId("status-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveClass("sr-only");
  });
});

describe("useMultiWallet and useFreighter announcement lifecycle", () => {
  function TestMultiWalletConsumer() {
    const { statusAnnouncement, announceStatus } = useMultiWallet();
    return (
      <div>
        <span data-testid="status-text">{statusAnnouncement || "none"}</span>
        <button onClick={() => announceStatus("Custom status update")}>
          Announce
        </button>
      </div>
    );
  }

  it("allows consumer components to trigger status announcements via MultiWalletProvider", () => {
    render(
      <MultiWalletProvider>
        <TestMultiWalletConsumer />
      </MultiWalletProvider>
    );

    expect(screen.getByTestId("status-text")).toHaveTextContent("none");
    act(() => {
      screen.getByText("Announce").click();
    });
    expect(screen.getByTestId("status-text")).toHaveTextContent("Custom status update");
  });

  function TestFreighterConsumer() {
    const { statusAnnouncement, announceStatus } = useFreighterWallet();
    return (
      <div>
        <span data-testid="freighter-status-text">{statusAnnouncement || "freighter-none"}</span>
        <button onClick={() => announceStatus("Freighter signature pending")}>
          Announce Freighter
        </button>
      </div>
    );
  }

  it("allows consumer components to trigger status announcements via Freighter WalletProvider", () => {
    render(
      <FreighterWalletProvider>
        <TestFreighterConsumer />
      </FreighterWalletProvider>
    );

    expect(screen.getByTestId("freighter-status-text")).toHaveTextContent("freighter-none");
    act(() => {
      screen.getByText("Announce Freighter").click();
    });
    expect(screen.getByTestId("freighter-status-text")).toHaveTextContent("Freighter signature pending");
  });
});
