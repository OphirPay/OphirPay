import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ARIA } from "@/lib/aria-labels";
import { WalletButton } from "@/components/WalletButton";
import { WalletSelector } from "@/components/WalletSelector";
import { PaymentTimeline } from "@/components/payments/PaymentTimeline";
import type { PaymentLifecycleStep } from "@/lib/payment-lifecycle";

// Mock useWallet
const mockWallet = {
  connected: false,
  publicKey: null as string | null,
  network: null as string | null,
  balance: null as string | null,
  balanceLoading: false,
  activeWalletId: null,
};

let mockStatusAnnouncement: string | null = null;
let mockIsConnecting = false;
let mockError: string | null = null;

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: mockWallet,
    connect: vi.fn(),
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: mockIsConnecting,
    error: mockError,
    availableWallets: ["freighter"],
    statusAnnouncement: mockStatusAnnouncement,
  }),
}));

describe("Issue #1292: ARIA live regions for transaction and wallet status announcements", () => {
  it("defines standard ARIA live status announcement constants", () => {
    expect(ARIA.WALLET_CONNECTING).toBe("Connecting to wallet");
    expect(ARIA.WALLET_CONNECTED).toBe("Wallet connected successfully");
    expect(ARIA.WALLET_DISCONNECTED).toBe("Wallet disconnected");
    expect(ARIA.WALLET_CONNECTION_ERROR).toBe("Wallet connection failed");
    expect(ARIA.TRANSACTION_SIGNING).toBe("Waiting for wallet signature");
    expect(ARIA.TRANSACTION_SUBMITTING).toBe("Submitting transaction to network");
    expect(ARIA.TRANSACTION_CONFIRMED).toBe("Transaction confirmed on-chain");
    expect(ARIA.TRANSACTION_FAILED).toBe("Transaction failed");
  });

  it("renders polite live region in WalletButton for disconnected state", () => {
    mockWallet.connected = false;
    mockWallet.publicKey = null;
    mockIsConnecting = false;
    mockStatusAnnouncement = null;

    render(<WalletButton />);

    const announcer = screen.getByTestId("wallet-status-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveAttribute("aria-atomic", "true");
  });

  it("announces connecting state in WalletButton live region", () => {
    mockWallet.connected = false;
    mockIsConnecting = true;
    mockStatusAnnouncement = ARIA.WALLET_CONNECTING;

    render(<WalletButton />);

    const announcer = screen.getByTestId("wallet-status-announcer");
    expect(announcer).toHaveTextContent(ARIA.WALLET_CONNECTING);
  });

  it("announces connected state with address in WalletButton live region", () => {
    mockWallet.connected = true;
    mockWallet.publicKey = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
    mockIsConnecting = false;
    mockStatusAnnouncement = `${ARIA.WALLET_CONNECTED}: GBRP...OX2H`;

    render(<WalletButton />);

    const announcer = screen.getByTestId("wallet-status-announcer");
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Wallet connected successfully: GBRP...OX2H");
  });

  it("renders live region in WalletSelector announcing selected wallet connection", () => {
    render(
      <WalletSelector
        availableWallets={["freighter"]}
        onSelect={vi.fn()}
        isConnecting={true}
        connectingWallet="freighter"
        onClose={vi.fn()}
      />
    );

    const announcer = screen.getByTestId("wallet-selector-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveAttribute("aria-atomic", "true");
    expect(announcer).toHaveTextContent(/Connecting to wallet to Freighter/i);
  });

  it("renders live region in PaymentTimeline announcing active transaction lifecycle state", () => {
    const steps: PaymentLifecycleStep[] = [
      {
        state: "CREATED",
        label: "Created",
        description: "Payment initiated",
        reached: true,
        current: false,
        terminal: false,
      },
      {
        state: "SIGNED",
        label: "Signed",
        description: "Signed by wallet",
        reached: true,
        current: false,
        terminal: false,
      },
      {
        state: "SUBMITTED",
        label: "Submitted",
        description: "Broadcasting transaction to Stellar",
        reached: false,
        current: true,
        terminal: false,
      },
      {
        state: "CONFIRMED",
        label: "Confirmed",
        description: "Confirmed on-chain",
        reached: false,
        current: false,
        terminal: true,
      },
    ];

    render(<PaymentTimeline steps={steps} />);

    const announcer = screen.getByTestId("payment-timeline-announcer");
    expect(announcer).toBeInTheDocument();
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveAttribute("aria-atomic", "true");
    expect(announcer).toHaveTextContent("Payment lifecycle: Submitted - Broadcasting transaction to Stellar");
  });
});
