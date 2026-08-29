// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FeeConfigPage, { MAX_FEE_BPS } from "@/app/fee-config/page";
import * as contractAdvanced from "@/lib/contract-advanced";
import * as multiWallet from "@/hooks/useMultiWallet";
import * as apiQuery from "@/hooks/useApiQuery";
import * as toastHook from "@/components/ui/Toast";

// Mock hooks and contract modules
vi.mock("@/lib/contract-advanced", async (importOriginal) => {
  const actual = await importOriginal<typeof contractAdvanced>();
  return {
    ...actual,
    setFeeConfig: vi.fn(),
    setFeeCollector: vi.fn(),
  };
});

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: vi.fn(),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

describe("FeeConfigPage - Fee-config admin UI wired to the contract", () => {
  const mockAdminAddress = "GBADMIN" + "1".repeat(49); // 56 chars
  const mockCollectorAddress = "GCCOLLECTOR" + "1".repeat(45); // 56 chars
  const mockTxHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  const defaultMockConfig = {
    payment_fee_bps: 50,
    escrow_fee_bps: 100,
    stream_fee_bps: 200,
    batch_base_fee: 10000000,
    batch_per_item_fee: 1000000,
    enabled: true,
  };

  const defaultMockCollector = {
    collector: mockCollectorAddress,
    available: true,
  };

  const defaultMockHistory = [
    {
      version: 1,
      config: defaultMockConfig,
      changed_at: 1700000000,
      changed_by: mockAdminAddress,
    },
  ];

  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const refetchConfig = vi.fn();
  const refetchCollector = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (toastHook.useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
    });

    (multiWallet.useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      wallet: {
        connected: true,
        publicKey: mockAdminAddress,
      },
    });

    (apiQuery.useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((keys: string[], _path?: string) => {
      const key = keys[0];
      if (key === "fee-config") {
        return {
          data: defaultMockConfig,
          isLoading: false,
          refetch: refetchConfig,
        };
      }
      if (key === "fee-collector") {
        return {
          data: defaultMockCollector,
          isLoading: false,
          refetch: refetchCollector,
        };
      }
      if (key === "fee-config-history") {
        return {
          data: defaultMockHistory,
          isLoading: false,
        };
      }
      if (key === "rbac") {
        return {
          data: { address: mockAdminAddress, role: 1 }, // Admin
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
  });

  it("exports MAX_FEE_BPS capped at 1000 (10%)", () => {
    expect(MAX_FEE_BPS).toBe(1000);
  });

  it("renders loading skeleton while fetching on-chain data", () => {
    (apiQuery.useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((keys: string[]) => {
      if (keys[0] === "fee-config") {
        return { data: null, isLoading: true, refetch: vi.fn() };
      }
      return { data: null, isLoading: false };
    });

    const { container } = render(<FeeConfigPage />);
    expect(container.querySelector(".animate-pulse")).toBeDefined();
  });

  it("renders wallet disconnected warning when user is not connected", () => {
    (multiWallet.useWallet as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      wallet: { connected: false, publicKey: null },
    });

    render(<FeeConfigPage />);
    expect(screen.getByTestId("wallet-disconnected-alert")).toBeDefined();
    expect(screen.getByText("Wallet not connected")).toBeDefined();
  });

  it("renders non-admin alert when connected user does not have Admin role", () => {
    (apiQuery.useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((keys: string[]) => {
      if (keys[0] === "rbac") {
        return { data: { address: mockAdminAddress, role: 2 }, isLoading: false }; // Operator
      }
      if (keys[0] === "fee-config") return { data: defaultMockConfig, isLoading: false, refetch: refetchConfig };
      if (keys[0] === "fee-collector") return { data: defaultMockCollector, isLoading: false, refetch: refetchCollector };
      if (keys[0] === "fee-config-history") return { data: defaultMockHistory, isLoading: false };
      return { data: null, isLoading: false };
    });

    render(<FeeConfigPage />);
    expect(screen.getByTestId("non-admin-alert")).toBeDefined();
    expect(screen.getByText("Admin permissions required")).toBeDefined();
  });

  it("renders on-chain fee values, collector, and version history correctly", () => {
    render(<FeeConfigPage />);

    expect(screen.getByText("Fee Configuration")).toBeDefined();
    expect(screen.getByTestId("payment-fee-value").textContent).toContain("0.50%");
    expect(screen.getByTestId("escrow-fee-value").textContent).toContain("1.00%");
    expect(screen.getByTestId("stream-fee-value").textContent).toContain("2.00%");
    expect(screen.getByTestId("batch-base-fee-value").textContent).toContain("1 XLM");
    expect(screen.getByTestId("batch-per-item-fee-value").textContent).toContain("0.1 XLM");
    expect(screen.getByTestId("fee-collector-address").textContent).toContain(mockCollectorAddress);
    expect(screen.getByText("v1")).toBeDefined();
  });

  it("renders empty state when no fee configuration is set on-chain", () => {
    (apiQuery.useApiQuery as unknown as ReturnType<typeof vi.fn>).mockImplementation((keys: string[]) => {
      if (keys[0] === "fee-config") {
        return { data: null, isLoading: false, refetch: vi.fn() };
      }
      if (keys[0] === "fee-collector") return { data: { collector: null }, isLoading: false, refetch: refetchCollector };
      if (keys[0] === "fee-config-history") return { data: [], isLoading: false };
      if (keys[0] === "rbac") return { data: { address: mockAdminAddress, role: 1 }, isLoading: false };
      return { data: null, isLoading: false };
    });

    render(<FeeConfigPage />);
    expect(screen.getByText("No Fee Config Set")).toBeDefined();
  });

  it("prefills form inputs with current on-chain config when opening Edit Fees modal", () => {
    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("edit-fees-btn"));

    const paymentInput = screen.getByTestId("input-payment-fee") as HTMLInputElement;
    const escrowInput = screen.getByTestId("input-escrow-fee") as HTMLInputElement;
    const streamInput = screen.getByTestId("input-stream-fee") as HTMLInputElement;
    const batchBaseInput = screen.getByTestId("input-batch-base-fee") as HTMLInputElement;
    const batchItemInput = screen.getByTestId("input-batch-item-fee") as HTMLInputElement;
    const enabledInput = screen.getByTestId("checkbox-fee-enabled") as HTMLInputElement;

    expect(paymentInput.value).toBe("50");
    expect(escrowInput.value).toBe("100");
    expect(streamInput.value).toBe("200");
    expect(batchBaseInput.value).toBe("10000000");
    expect(batchItemInput.value).toBe("1000000");
    expect(enabledInput.checked).toBe(true);
  });

  it("validates and rejects fee bps > 1000 (10%)", async () => {
    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("edit-fees-btn"));

    const paymentInput = screen.getByTestId("input-payment-fee");
    fireEvent.change(paymentInput, { target: { value: "1001" } });

    fireEvent.click(screen.getByTestId("submit-fee-config-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Payment fee must be an integer between 0 and 1000 bps/i)).toBeDefined();
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("Validation error: fee basis points must be between 0 and 1000 bps")
      );
    });

    expect(contractAdvanced.setFeeConfig).not.toHaveBeenCalled();
  });

  it("validates and rejects negative fee bps or batch fees", async () => {
    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("edit-fees-btn"));

    const escrowInput = screen.getByTestId("input-escrow-fee");
    fireEvent.change(escrowInput, { target: { value: "-5" } });

    const batchBaseInput = screen.getByTestId("input-batch-base-fee");
    fireEvent.change(batchBaseInput, { target: { value: "-100" } });

    fireEvent.click(screen.getByTestId("submit-fee-config-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Escrow fee must be an integer between 0 and 1000 bps/i)).toBeDefined();
      expect(screen.getByText(/Batch base fee must be a non-negative integer/i)).toBeDefined();
    });

    expect(contractAdvanced.setFeeConfig).not.toHaveBeenCalled();
  });

  it("successfully updates fee config on-chain and displays transaction results banner", async () => {
    (contractAdvanced.setFeeConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      txHash: mockTxHash,
    });

    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("edit-fees-btn"));

    const paymentInput = screen.getByTestId("input-payment-fee");
    fireEvent.change(paymentInput, { target: { value: "75" } });

    const escrowInput = screen.getByTestId("input-escrow-fee");
    fireEvent.change(escrowInput, { target: { value: "150" } });

    const streamInput = screen.getByTestId("input-stream-fee");
    fireEvent.change(streamInput, { target: { value: "250" } });

    fireEvent.click(screen.getByTestId("submit-fee-config-btn"));

    await waitFor(() => {
      expect(contractAdvanced.setFeeConfig).toHaveBeenCalledWith(
        mockAdminAddress,
        75,
        150,
        250,
        10000000,
        1000000,
        true
      );
      expect(toastSuccess).toHaveBeenCalledWith("Fee configuration saved on-chain");
    });

    // Verify transaction result banner is displayed
    await waitFor(() => {
      expect(screen.getByTestId("tx-result-banner")).toBeDefined();
      expect(screen.getByText("Fee Configuration Saved On-Chain")).toBeDefined();
      expect(screen.getByText(/Updated fees:/i)).toBeDefined();
    });
  });

  it("handles contract execution failure during fee config update", async () => {
    (contractAdvanced.setFeeConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Smart contract execution failed: HostError: Error(Contract, #100)",
    });

    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("edit-fees-btn"));
    fireEvent.click(screen.getByTestId("submit-fee-config-btn"));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Smart contract execution failed: HostError: Error(Contract, #100)"
      );
      expect(screen.getByTestId("tx-result-banner")).toBeDefined();
      expect(screen.getByText("Fee Configuration Update Failed")).toBeDefined();
    });
  });

  it("handles network error during fee config update", async () => {
    (contractAdvanced.setFeeConfig as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network connection dropped")
    );

    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("edit-fees-btn"));
    fireEvent.click(screen.getByTestId("submit-fee-config-btn"));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Network error while submitting fee configuration");
      expect(screen.getByTestId("tx-result-banner")).toBeDefined();
      expect(screen.getByText("Transaction Error")).toBeDefined();
    });
  });

  it("prefills collector input and validates address when setting collector", async () => {
    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("set-collector-btn"));

    const collectorInput = screen.getByTestId("input-collector-address") as HTMLInputElement;
    expect(collectorInput.value).toBe(mockCollectorAddress);

    // Test invalid address
    fireEvent.change(collectorInput, { target: { value: "invalid-key" } });
    fireEvent.click(screen.getByTestId("submit-collector-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Invalid Stellar address/i)).toBeDefined();
      expect(toastError).toHaveBeenCalledWith("Invalid collector address format");
    });
    expect(contractAdvanced.setFeeCollector).not.toHaveBeenCalled();
  });

  it("submits collector update on-chain and displays transaction results", async () => {
    const newCollector = "GBNEWCOLLECTOR" + "1".repeat(42); // 56 chars
    (contractAdvanced.setFeeCollector as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      txHash: mockTxHash,
    });

    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("set-collector-btn"));

    const collectorInput = screen.getByTestId("input-collector-address");
    fireEvent.change(collectorInput, { target: { value: newCollector } });
    fireEvent.click(screen.getByTestId("submit-collector-btn"));

    await waitFor(() => {
      expect(contractAdvanced.setFeeCollector).toHaveBeenCalledWith(mockAdminAddress, newCollector);
      expect(toastSuccess).toHaveBeenCalledWith("Fee collector updated on-chain");
      expect(screen.getByTestId("tx-result-banner")).toBeDefined();
      expect(screen.getByText("Fee Collector Updated On-Chain")).toBeDefined();
    });
  });

  it("allows dismissing the transaction result banner", async () => {
    (contractAdvanced.setFeeCollector as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      txHash: mockTxHash,
    });

    render(<FeeConfigPage />);

    fireEvent.click(screen.getByTestId("set-collector-btn"));
    fireEvent.click(screen.getByTestId("submit-collector-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("tx-result-banner")).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText("Dismiss transaction result"));
    expect(screen.queryByTestId("tx-result-banner")).toBeNull();
  });
});
