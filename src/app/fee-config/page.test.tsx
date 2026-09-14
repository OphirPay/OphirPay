// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FeeConfigPage from "./page";

// Hoisted mocks let tests configure each module mock before the page renders.
// The mocked modules are declared via `vi.mock` below, and tests drive the
// return values through `mocks.*` (no `as any` casts needed).
const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  useApiQuery: vi.fn(),
  setFeeConfig: vi.fn(),
  setFeeCollector: vi.fn(),
}));

// Mock the hooks and contract functions
vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: mocks.useWallet,
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: mocks.useApiQuery,
}));

vi.mock("@/lib/contract-advanced", () => ({
  setFeeConfig: mocks.setFeeConfig,
  setFeeCollector: mocks.setFeeCollector,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

describe("FeeConfigPage", () => {
  const mockWallet = {
    publicKey: "GABC1234567890",
    connected: true,
  };

  const mockConfig = {
    payment_fee_bps: 100,
    escrow_fee_bps: 200,
    stream_fee_bps: 300,
    batch_base_fee: 1000000,
    batch_per_item_fee: 100000,
    enabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mocks.useWallet.mockReturnValue({ wallet: mockWallet });
    mocks.useApiQuery.mockReturnValue({
      data: mockConfig,
      isLoading: false,
      error: null,
    });
  });

  it("renders fee configuration with on-chain values", () => {
    render(<FeeConfigPage />);
    
    expect(screen.getByText("Fee Configuration")).toBeInTheDocument();
    expect(screen.getByText("1.00%")).toBeInTheDocument(); // 100 bps
    expect(screen.getByText("2.00%")).toBeInTheDocument(); // 200 bps
    expect(screen.getByText("3.00%")).toBeInTheDocument(); // 300 bps
    expect(screen.getByText("100 bps")).toBeInTheDocument();
    expect(screen.getByText("200 bps")).toBeInTheDocument();
    expect(screen.getByText("300 bps")).toBeInTheDocument();
  });

  it("successfully updates fee config with transaction hash", async () => {
    const mockTxHash = "0xabc123def456789";
    mocks.setFeeConfig.mockResolvedValue({
      success: true,
      txHash: mockTxHash,
    });

    render(<FeeConfigPage />);
    
    // Open fee modal
    fireEvent.click(screen.getByText("⚙ Edit Fees"));
    
    // Update payment fee
    const paymentInput = screen.getByLabelText("Payment Fee (bps)");
    fireEvent.change(paymentInput, { target: { value: "150" } });
    
    // Submit form
    const submitButton = screen.getByText("Save Fee Configuration");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.setFeeConfig).toHaveBeenCalledWith(
        "GABC1234567890",
        150,
        200,
        300,
        1000000,
        100000,
        true,
      );
      expect(screen.getByText(/Tx: 0xabc123def456789/)).toBeInTheDocument();
      expect(screen.getByText("Fee configuration saved on-chain")).toBeInTheDocument();
    });
  });

  it("validates fee bps limits and disables submit", async () => {
    render(<FeeConfigPage />);
    
    // Open fee modal
    fireEvent.click(screen.getByText("⚙ Edit Fees"));
    
    // Try to set fee above max
    const paymentInput = screen.getByLabelText("Payment Fee (bps)");
    fireEvent.change(paymentInput, { target: { value: "1500" } });
    
    // Submit button should be disabled
    const submitButton = screen.getByText("Save Fee Configuration");
    expect(submitButton).toBeDisabled();
    
    // Input should show error styling
    expect(paymentInput).toHaveClass("border-red-500");
  });

  it("shows validation errors when submitting invalid fees", async () => {
    render(<FeeConfigPage />);
    
    // Open fee modal
    fireEvent.click(screen.getByText("⚙ Edit Fees"));
    
    // Set invalid fees
    const paymentInput = screen.getByLabelText("Payment Fee (bps)");
    fireEvent.change(paymentInput, { target: { value: "1500" } });
    
    const escrowInput = screen.getByLabelText("Escrow Fee (bps)");
    fireEvent.change(escrowInput, { target: { value: "-10" } });
    
    // Submit should not be called
    expect(mocks.setFeeConfig).not.toHaveBeenCalled();
  });

  it("shows error on failed contract call", async () => {
    mocks.setFeeConfig.mockResolvedValue({
      success: false,
      error: "Contract rejected transaction: fee too high",
    });

    render(<FeeConfigPage />);
    
    // Open fee modal
    fireEvent.click(screen.getByText("⚙ Edit Fees"));
    
    // Submit form with valid values
    const submitButton = screen.getByText("Save Fee Configuration");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Contract rejected transaction: fee too high")).toBeInTheDocument();
    });
  });

  it("updates fee collector successfully", async () => {
    const mockTxHash = "0xcollector123";
    mocks.setFeeCollector.mockResolvedValue({
      success: true,
      txHash: mockTxHash,
    });

    render(<FeeConfigPage />);
    
    // Open collector modal
    fireEvent.click(screen.getByText("💰 Set Collector"));
    
    // Enter collector address
    const collectorInput = screen.getByLabelText("Collector Address");
    fireEvent.change(collectorInput, { target: { value: "GCOLLECTOR123456789" } });
    
    // Submit
    const submitButton = screen.getByRole("button", { name: "Set Fee Collector" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mocks.setFeeCollector).toHaveBeenCalledWith(
        "GABC1234567890",
        "GCOLLECTOR123456789",
      );
      expect(screen.getByText(/Tx: 0xcollector123/)).toBeInTheDocument();
    });
  });

  it("shows wallet connection warning when disconnected", () => {
    mocks.useWallet.mockReturnValue({ 
      wallet: { connected: false, publicKey: null } 
    });

    render(<FeeConfigPage />);
    
    expect(screen.getByText("Wallet not connected")).toBeInTheDocument();
    expect(screen.getByText("Connect your wallet to update fee configuration on-chain.")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mocks.useApiQuery.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    render(<FeeConfigPage />);
    
    // Should show skeleton loading
    const skeletonElements = document.querySelectorAll(".animate-pulse");
    expect(skeletonElements.length).toBeGreaterThan(0);
  });

  it("shows empty state when no config exists", () => {
    mocks.useApiQuery.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });

    render(<FeeConfigPage />);
    
    expect(screen.getByText("No Fee Config Set")).toBeInTheDocument();
    expect(screen.getByText("Configure your protocol fee structure on-chain.")).toBeInTheDocument();
  });
});
