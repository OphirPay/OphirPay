// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MultisigPage from "@/app/multisig/page";
import * as contractAdvanced from "@/lib/contract-advanced";

const SIGNER_1 = "GA11111111111111111111111111111111111111111111111111111111";
const SIGNER_2 = "GA22222222222222222222222222222222222222222222222222222222";
const NON_SIGNER = "GB99999999999999999999999999999999999999999999999999999999";
const RECIPIENT = "GC33333333333333333333333333333333333333333333333333333333";

let currentWalletKey = SIGNER_1;
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: currentWalletKey,
      network: "TESTNET",
    },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePageTitle", () => ({
  usePageTitle: vi.fn(),
}));

let mockConfigData: unknown = {
  threshold: 2,
  signers: [SIGNER_1, SIGNER_2],
  enabled: true,
};

let mockRequestsData: unknown = {
  requests: [],
  available: true,
};

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (queryKey: string[]) => {
    if (queryKey[0] === "multisig" && queryKey[1] === "config") {
      return {
        data: mockConfigData,
        isLoading: false,
        refetch: vi.fn(),
      };
    }
    if (queryKey[0] === "multisig" && queryKey[1] === "requests") {
      return {
        data: mockRequestsData,
        isLoading: false,
        refetch: vi.fn(),
      };
    }
    return { data: null, isLoading: false, refetch: vi.fn() };
  },
}));

vi.mock("@/lib/contract-advanced", () => ({
  setMultisigConfig: vi.fn().mockResolvedValue({ success: true, txHash: "tx-cfg-1" }),
  proposeMultisigPayment: vi.fn().mockResolvedValue({ success: true, data: 101, txHash: "tx-prop-1" }),
  approveMultisigPayment: vi.fn().mockResolvedValue({ success: true, txHash: "tx-app-1" }),
  executeApprovedPayment: vi.fn().mockResolvedValue({ success: true, data: 501, txHash: "tx-exec-1" }),
  DEFAULT_CONTRACT_ID: "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
}));

function renderMultisigPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MultisigPage />
    </QueryClientProvider>
  );
}

describe("MultisigFlow - 2 Signers Approval and Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentWalletKey = SIGNER_1;
    mockConfigData = {
      threshold: 2,
      signers: [SIGNER_1, SIGNER_2],
      enabled: true,
    };
    mockRequestsData = {
      requests: [],
      available: true,
    };
  });

  it("renders active 2-of-2 multisig configuration correctly", async () => {
    renderMultisigPage();
    expect(screen.getByText("Multisig Approvals")).toBeInTheDocument();
    expect(screen.getByText("2/2 threshold")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Propose Payment" })).toBeEnabled();
  });

  it("disables Propose Payment when multisig is inactive", async () => {
    mockConfigData = {
      threshold: 0,
      signers: [],
      enabled: false,
    };
    renderMultisigPage();
    expect(screen.getByText("Multisig not configured")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Propose Payment" })).toBeDisabled();
  });

  it("rejects approval attempt when connected wallet is not an authorized signer", async () => {
    currentWalletKey = NON_SIGNER;
    mockRequestsData = {
      requests: [
        {
          id: 101,
          proposer: SIGNER_1,
          payee: RECIPIENT,
          amount: "250.00",
          approvals_count: 0,
          threshold_met: false,
          executed: false,
        },
      ],
      available: true,
    };

    renderMultisigPage();

    expect(await screen.findByText(/ID:\s*101/)).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();

    const approveBtn = screen.getByRole("button", { name: "✓ Approve" });
    fireEvent.click(approveBtn);

    expect(mockToastError).toHaveBeenCalledWith("Not an authorized signer for this multisig");
    expect(contractAdvanced.approveMultisigPayment).not.toHaveBeenCalled();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
  });

  it("handles on-chain contract rejection when approval fails", async () => {
    currentWalletKey = SIGNER_1;
    mockRequestsData = {
      requests: [
        {
          id: 101,
          proposer: SIGNER_1,
          payee: RECIPIENT,
          amount: "250.00",
          approvals_count: 0,
          threshold_met: false,
          executed: false,
        },
      ],
      available: true,
    };

    vi.mocked(contractAdvanced.approveMultisigPayment).mockResolvedValueOnce({
      success: false,
      error: "Smart contract execution failed: PaymentError::NotASigner",
    });

    renderMultisigPage();

    expect(await screen.findByText(/ID:\s*101/)).toBeInTheDocument();
    const approveBtn = screen.getByRole("button", { name: "✓ Approve" });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Smart contract execution failed: PaymentError::NotASigner"
      );
    });
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
  });

  it("proposes a payment and enforces 2-of-2 approval threshold before execution", async () => {
    currentWalletKey = SIGNER_1;
    renderMultisigPage();

    // 1. Propose payment
    fireEvent.click(screen.getByRole("button", { name: "+ Propose Payment" }));
    expect(screen.getByText("Create a payment that requires multisig approval.")).toBeInTheDocument();

    const recipientInput = screen.getByPlaceholderText("GABC...");
    const amountInput = screen.getByPlaceholderText("100.00");
    fireEvent.change(recipientInput, { target: { value: RECIPIENT } });
    fireEvent.change(amountInput, { target: { value: "250.00" } });

    // Submit propose modal
    const dialog = screen.getByRole("dialog");
    const proposeModalBtn = within(dialog).getByRole("button", { name: "Propose Payment" });
    fireEvent.click(proposeModalBtn);

    await waitFor(() => {
      expect(contractAdvanced.proposeMultisigPayment).toHaveBeenCalledWith(
        SIGNER_1,
        RECIPIENT,
        2500000000,
        expect.any(String),
        expect.any(String)
      );
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Payment proposed for multisig approval");

    // Verify request card rendered
    expect(await screen.findByText(/ID:\s*101/)).toBeInTheDocument();
    expect(screen.getByText("250.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();

    // 2. Threshold enforcement: Execute button MUST NOT be present, only Approve button
    expect(screen.getByRole("button", { name: "✓ Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();

    // 3. First signer approves (1/2 threshold)
    fireEvent.click(screen.getByRole("button", { name: "✓ Approve" }));
    await waitFor(() => {
      expect(contractAdvanced.approveMultisigPayment).toHaveBeenCalledWith(SIGNER_1, 101);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Approval submitted on-chain");

    // UI shows 1/2 approvals, Execute button is STILL NOT present (threshold enforcement)
    expect(await screen.findByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✓ Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();

    // 4. Second signer approves (2/2 threshold reached)
    fireEvent.click(screen.getByRole("button", { name: "✓ Approve" }));
    await waitFor(() => {
      expect(contractAdvanced.approveMultisigPayment).toHaveBeenCalledWith(SIGNER_1, 101);
    });

    // UI shows 2/2 approvals, Approve button is replaced by Execute button
    expect(await screen.findByText("2/2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✓ Approve" })).not.toBeInTheDocument();
    const executeBtn = screen.getByRole("button", { name: "Execute" });
    expect(executeBtn).toBeInTheDocument();

    // 5. Execute payment
    fireEvent.click(executeBtn);
    await waitFor(() => {
      expect(contractAdvanced.executeApprovedPayment).toHaveBeenCalledWith(SIGNER_1, 101);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("Payment executed on-chain");

    // 6. Request transitions to Executed and buttons are removed
    expect(await screen.findByText("Executed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "✓ Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
  });
});
