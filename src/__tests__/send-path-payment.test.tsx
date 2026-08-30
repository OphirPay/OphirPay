// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SendPage from "@/app/send/page";
import * as stellarLib from "@/lib/stellar";
import { USDC_TESTNET } from "@/lib/assets";
import type { Horizon } from "@stellar/stellar-sdk";

// Mock useMultiWallet
vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      activeWalletId: "freighter",
      balance: "100.00",
    },
    fetchBalance: vi.fn(),
  }),
}));

// Mock wallet connector
vi.mock("@/lib/wallets", () => ({
  getWalletConnector: () => ({
    signTransaction: vi.fn().mockResolvedValue("AAAA_SIGNED_XDR"),
  }),
}));

// Mock useToast
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock fee-estimator
vi.mock("@/lib/fee-estimator", () => ({
  estimateTransactionFee: vi.fn().mockResolvedValue({
    baseFee: "100",
    networkCongestion: "low",
  }),
}));

// Mock contracts
vi.mock("@/lib/contracts", () => ({
  recordPaymentOnChain: vi.fn().mockResolvedValue({
    status: "RECORDED",
    txHash: "mock_onchain_hash_123",
  }),
}));

// Mock useApiMutation
vi.mock("@/hooks/useApiQuery", () => ({
  useApiMutation: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: "pay_123" }),
  }),
}));

// Mock trustline
vi.mock("@/lib/trustline", () => ({
  checkTrustline: vi.fn().mockResolvedValue({ hasTrustline: true, balance: "100" }),
}));

describe("SendPage - Path Payment Cross-Asset UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(stellarLib, "fetchAllBalances").mockResolvedValue([]);
    vi.spyOn(stellarLib, "accountExists").mockResolvedValue(true);
  });

  it("renders standard payment mode when source and destination assets match", () => {
    render(<SendPage />);

    expect(screen.getByText("Send Payment")).toBeInTheDocument();
    expect(screen.getByText("You Send (Source Asset)")).toBeInTheDocument();
    expect(screen.getByText("Recipient Receives (Destination Asset)")).toBeInTheDocument();
    expect(screen.queryByTestId("cross-asset-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rate-preview-card")).not.toBeInTheDocument();
  });

  it("activates cross-asset mode and displays rate preview when path is found", async () => {
    const mockEstimate: stellarLib.PathPaymentEstimate = {
      sourceAsset: { code: "XLM", type: "native" },
      destAsset: { code: "USDC", issuer: USDC_TESTNET.issuer, type: "credit_alphanum4" },
      sourceAmount: "10",
      destinationAmount: "1.2500000",
      destMin: "1.2375000",
      exchangeRate: 0.125,
      path: [],
      pathAssets: [],
    };

    vi.spyOn(stellarLib, "findStrictSendPath").mockResolvedValue(mockEstimate);

    render(<SendPage />);

    // Enter destination address
    const destInput = screen.getByTestId("destination-input");
    fireEvent.change(destInput, {
      target: { value: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU" },
    });

    // Enter amount
    const amountInput = screen.getByTestId("amount-input");
    fireEvent.change(amountInput, { target: { value: "10" } });

    // Switch destination asset to USDC
    const assetButtons = screen.getAllByRole("button", { name: /XLM/i });
    // Click the second asset selector (Recipient Receives)
    fireEvent.click(assetButtons[1]);

    // Choose USDC from dropdown
    const usdcOption = await screen.findByText("USDC (Testnet)");
    fireEvent.click(usdcOption);

    // Cross-asset badge should appear
    await waitFor(() => {
      expect(screen.getByTestId("cross-asset-badge")).toBeInTheDocument();
      expect(screen.getByTestId("rate-preview-card")).toBeInTheDocument();
    }, { timeout: 8000 });

    // Verify rate and estimated destination amount are displayed
    await waitFor(() => {
      expect(screen.getByTestId("exchange-rate-display")).toHaveTextContent("1 XLM ≈ 0.125000 USDC");
      expect(screen.getByTestId("estimated-dest-amount")).toHaveTextContent("~1.2500000 USDC");
    }, { timeout: 8000 });
  }, 15000);

  it("displays clear error message and disables send button when no path exists", async () => {
    vi.spyOn(stellarLib, "findStrictSendPath").mockResolvedValue(null);

    render(<SendPage />);

    // Destination
    const destInput = screen.getByTestId("destination-input");
    fireEvent.change(destInput, {
      target: { value: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU" },
    });

    // Amount
    const amountInput = screen.getByTestId("amount-input");
    fireEvent.change(amountInput, { target: { value: "50" } });

    // Switch destination asset to USDC
    const assetButtons = screen.getAllByRole("button", { name: /XLM/i });
    fireEvent.click(assetButtons[1]);
    const usdcOption = await screen.findByText("USDC (Testnet)");
    fireEvent.click(usdcOption);

    // Path error box should appear
    await waitFor(() => {
      expect(screen.getByTestId("path-error-box")).toBeInTheDocument();
      expect(screen.getByTestId("path-error-box")).toHaveTextContent(/No path found with sufficient liquidity/i);
    }, { timeout: 8000 });

    // Send button should be disabled
    const sendBtn = screen.getByTestId("send-btn");
    expect(sendBtn).toBeDisabled();
    expect(sendBtn).toHaveTextContent("No Path Available");
  }, 15000);

  it("successfully executes a cross-asset path payment and shows success screen", async () => {
    const mockEstimate: stellarLib.PathPaymentEstimate = {
      sourceAsset: { code: "XLM", type: "native" },
      destAsset: { code: "USDC", issuer: USDC_TESTNET.issuer, type: "credit_alphanum4" },
      sourceAmount: "20",
      destinationAmount: "2.5000000",
      destMin: "2.4750000",
      exchangeRate: 0.125,
      path: [],
      pathAssets: [],
    };

    vi.spyOn(stellarLib, "findStrictSendPath").mockResolvedValue(mockEstimate);
    vi.spyOn(stellarLib, "buildPathPaymentStrictSendTx").mockResolvedValue({
      xdr: "MOCK_PATH_PAYMENT_XDR",
      sourceAccount: {} as unknown as Horizon.AccountResponse,
    });
    vi.spyOn(stellarLib, "submitSignedTx").mockResolvedValue({
      hash: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
      successful: true,
    });

    render(<SendPage />);

    // Destination
    fireEvent.change(screen.getByTestId("destination-input"), {
      target: { value: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU" },
    });

    // Amount
    fireEvent.change(screen.getByTestId("amount-input"), {
      target: { value: "20" },
    });

    // Switch dest asset
    const assetButtons = screen.getAllByRole("button", { name: /XLM/i });
    fireEvent.click(assetButtons[1]);
    const usdcOption = await screen.findByText("USDC (Testnet)");
    fireEvent.click(usdcOption);

    // Wait for rate to be estimated
    await waitFor(() => {
      expect(screen.getByTestId("estimated-dest-amount")).toBeInTheDocument();
    }, { timeout: 8000 });

    // Click send button
    const sendBtn = screen.getByTestId("send-btn");
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    // Verify success screen
    await waitFor(() => {
      expect(screen.getByText("Path Payment Completed!")).toBeInTheDocument();
      expect(screen.getByText("~2.5000000 USDC")).toBeInTheDocument();
      expect(screen.getByText(/Recorded/)).toBeInTheDocument();
    }, { timeout: 8000 });
  }, 15000);
});
