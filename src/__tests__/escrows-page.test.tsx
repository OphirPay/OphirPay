// SPDX-License-Identifier: MIT

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import EscrowsPage from "@/app/escrows/page";

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockCreateEscrow = vi.hoisted(() => vi.fn());
const mockClaimEscrow = vi.hoisted(() => vi.fn());
const mockReleaseEscrow = vi.hoisted(() => vi.fn());
const mockReleaseByArbiter = vi.hoisted(() => vi.fn());
const mockSuccess = vi.hoisted(() => vi.fn());
const mockError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    },
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
}));

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));

vi.mock("@/lib/contract-advanced", () => ({
  createEscrow: mockCreateEscrow,
  claimEscrow: mockClaimEscrow,
  releaseEscrow: mockReleaseEscrow,
  releaseEscrowByArbiter: mockReleaseByArbiter,
  getContractOwner: vi.fn(),
}));

vi.mock("@/lib/on-chain-records", () => ({
  fetchRecentContractRecords: vi.fn(),
}));

const beneficiary = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const escrow = {
  id: 3,
  depositor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  beneficiary,
  arbiter: null,
  amount: 250_000_000,
  asset: "native",
  deadline: 1,
  released: false,
  claimed: false,
  metadata: "Milestone payment",
};

describe("EscrowsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockReturnValue({
      data: [escrow],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockClaimEscrow.mockResolvedValue({ success: true });
    mockCreateEscrow.mockResolvedValue({ success: true });
  });

  it("shows escrow parties, amount, deadline, and beneficiary claim action", () => {
    render(<EscrowsPage />);

    expect(screen.getByRole("heading", { name: /Escrow #3/ })).toBeTruthy();
    expect(screen.getByText("25.00 XLM")).toBeTruthy();
    expect(screen.getByText("Claim escrow")).toBeTruthy();
    expect(screen.getByText("Milestone payment")).toBeTruthy();
  });

  it("submits escrow creation in exact stroops and refreshes the list", async () => {
    const refetch = vi.fn();
    mockUseApiQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch,
    });
    render(<EscrowsPage />);
    fireEvent.click(screen.getByText("+ Create escrow"));
    fireEvent.change(screen.getByLabelText("Beneficiary Stellar address"), {
      target: { value: beneficiary },
    });
    fireEvent.change(screen.getByLabelText("Amount (XLM)"), {
      target: { value: "0.0000001" },
    });
    fireEvent.change(screen.getByLabelText("Beneficiary claim deadline"), {
      target: { value: "2030-01-01T00:00" },
    });
    fireEvent.click(screen.getByText("Sign and create escrow"));

    await waitFor(() => {
      expect(mockCreateEscrow).toHaveBeenCalledWith(
        beneficiary,
        beneficiary,
        null,
        BigInt(1),
        "native",
        Math.floor(new Date("2030-01-01T00:00").getTime() / 1000),
        "",
      );
      expect(refetch).toHaveBeenCalledOnce();
    });
  });
});
