// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ReceivePage from "@/app/receive/page";

const ADDR_A = "GA2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6X";
const ADDR_B = "GB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB";

let mockWalletState = {
  connected: true,
  publicKey: ADDR_A,
  network: "TESTNET",
};

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/receive",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: mockWalletState,
    connect: vi.fn(),
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
    availableWallets: ["freighter", "albedo", "xbull"],
  }),
}));

vi.mock("@/components/WalletButton", () => ({
  WalletButton: () => <button data-testid="mock-wallet-btn">Connect Wallet</button>,
}));

describe("ReceivePage", () => {
  beforeEach(() => {
    mockWalletState = {
      connected: true,
      publicKey: ADDR_A,
      network: "TESTNET",
    };
  });

  it("renders the connected account address, QR code, and copy button", () => {
    render(<ReceivePage />);

    expect(screen.getByText("Receive Payment")).toBeDefined();
    expect(screen.getByText("Wallet Connected")).toBeDefined();

    const addressEl = screen.getByTestId("receive-address");
    expect(addressEl).toBeDefined();

    const qrContainer = screen.getByTestId("qr-code-container");
    expect(qrContainer).toBeDefined();
    expect(qrContainer.innerHTML).toContain("<svg");

    const sep7Text = screen.getByTestId("sep7-uri-text");
    expect(sep7Text.textContent).toBe(`web+stellar:pay?destination=${ADDR_A}`);
  });

  it("renders a prompt to connect when wallet is disconnected", () => {
    mockWalletState = {
      connected: false,
      publicKey: null as unknown as string,
      network: "TESTNET",
    };

    render(<ReceivePage />);

    expect(screen.getByText("Connect your Stellar wallet")).toBeDefined();
    expect(screen.getByTestId("mock-wallet-btn")).toBeDefined();
  });

  it("regenerates the QR code and SEP-7 payload when account changes", () => {
    const { rerender } = render(<ReceivePage />);

    const initialSep7 = screen.getByTestId("sep7-uri-text").textContent;
    const initialQrSvg = screen.getByTestId("qr-code-container").innerHTML;
    expect(initialSep7).toBe(`web+stellar:pay?destination=${ADDR_A}`);

    // Change connected wallet account
    mockWalletState = {
      connected: true,
      publicKey: ADDR_B,
      network: "TESTNET",
    };

    rerender(<ReceivePage />);

    const updatedSep7 = screen.getByTestId("sep7-uri-text").textContent;
    const updatedQrSvg = screen.getByTestId("qr-code-container").innerHTML;

    expect(updatedSep7).toBe(`web+stellar:pay?destination=${ADDR_B}`);
    expect(updatedQrSvg).not.toBe(initialQrSvg);
    expect(updatedQrSvg).toContain("<svg");
  });

  it("updates SEP-7 payload and QR code when amount and memo are entered", () => {
    render(<ReceivePage />);

    const amountInput = screen.getByLabelText("Requested Amount");
    const memoInput = screen.getByLabelText("Memo");

    act(() => {
      fireEvent.change(amountInput, { target: { value: "123.45" } });
      fireEvent.change(memoInput, { target: { value: "test-memo-1" } });
    });

    const updatedSep7 = screen.getByTestId("sep7-uri-text").textContent;
    expect(updatedSep7).toContain(`destination=${ADDR_A}`);
    expect(updatedSep7).toContain("amount=123.45");
    expect(updatedSep7).toContain("memo=test-memo-1");
    expect(updatedSep7).toContain("memo_type=MEMO_TEXT");
  });

  it("allows setting custom token and memo type", () => {
    render(<ReceivePage />);

    const assetSelect = screen.getByLabelText("Asset / Token");
    const memoTypeSelect = screen.getByLabelText("Memo Type");
    const memoInput = screen.getByLabelText("Memo");

    act(() => {
      fireEvent.change(assetSelect, { target: { value: "USDC" } });
      fireEvent.change(memoInput, { target: { value: "48201" } });
      fireEvent.change(memoTypeSelect, { target: { value: "MEMO_ID" } });
    });

    const updatedSep7 = screen.getByTestId("sep7-uri-text").textContent;
    expect(updatedSep7).toContain("asset_code=USDC");
    expect(updatedSep7).toContain("memo=48201");
    expect(updatedSep7).toContain("memo_type=MEMO_ID");
  });
});
