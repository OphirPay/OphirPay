// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { EscrowCard } from "@/components/escrows/EscrowCard";
import { EscrowStateMachine } from "@/components/escrows/EscrowStateMachine";
import type { EscrowRecord } from "@/lib/escrows";

const DEPOSITOR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BENEFICIARY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ARBITER = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const OBSERVER = "GFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";

const mockToastShow = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    show: mockToastShow,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

const mockReleaseEscrow = vi.fn();
const mockClaimEscrow = vi.fn();
const mockReleaseByArbiter = vi.fn();
vi.mock("@/lib/contract-advanced", () => ({
  releaseEscrow: (...args: unknown[]) => mockReleaseEscrow(...args),
  claimEscrow: (...args: unknown[]) => mockClaimEscrow(...args),
  releaseByArbiter: (...args: unknown[]) => mockReleaseByArbiter(...args),
  createEscrow: vi.fn(),
}));

describe("Escrow UI Components & Role Action Gating", () => {
  const now = Math.floor(Date.now() / 1000);

  const sampleLockedEscrow: EscrowRecord = {
    id: 101,
    depositor: DEPOSITOR,
    beneficiary: BENEFICIARY,
    arbiter: ARBITER,
    amount: "2500000000", // 250 XLM
    asset: "native",
    deadline: now + 3600, // 1 hr future
    released: false,
    claimed: false,
    metadata: "Security Audit Completion Escrow",
  };

  const sampleExpiredEscrow: EscrowRecord = {
    ...sampleLockedEscrow,
    deadline: now - 100, // Expired
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("EscrowStateMachine", () => {
    it("renders the 3-stage visual state machine", () => {
      render(<EscrowStateMachine escrow={sampleLockedEscrow} />);

      expect(screen.getByText("Escrow State Machine")).toBeDefined();
      expect(screen.getByText("1. Funds Locked")).toBeDefined();
      expect(screen.getByText("2. Release Condition")).toBeDefined();
      expect(screen.getByText("3. Settled")).toBeDefined();
    });
  });

  describe("EscrowCard Role-Gated Actions", () => {
    it("renders escrow details, amount, participants, and status", () => {
      render(
        <EscrowCard
          escrow={sampleLockedEscrow}
          currentUserAddress={OBSERVER}
        />
      );

      expect(screen.getByText("Escrow #101")).toBeDefined();
      expect(screen.getByText("250.00 XLM")).toBeDefined();
      expect(screen.getByText(/Security Audit Completion Escrow/)).toBeDefined();
      expect(screen.getByText("LOCKED")).toBeDefined();
    });

    it("displays Release Early button for Depositor and executes releaseEscrow", async () => {
      mockReleaseEscrow.mockResolvedValueOnce({
        success: true,
        txHash: "release_tx_123",
      });

      const onUpdated = vi.fn();
      render(
        <EscrowCard
          escrow={sampleLockedEscrow}
          currentUserAddress={DEPOSITOR}
          onUpdated={onUpdated}
        />
      );

      expect(screen.getByText("You are Depositor")).toBeDefined();

      const releaseBtn = screen.getByRole("button", {
        name: /Release Early to Beneficiary/i,
      });
      expect(releaseBtn).toBeDefined();

      fireEvent.click(releaseBtn);

      await waitFor(() => {
        expect(mockReleaseEscrow).toHaveBeenCalledWith(DEPOSITOR, 101);
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("successfully released to beneficiary"),
          "success"
        );
        expect(onUpdated).toHaveBeenCalled();
      });
    });

    it("disables Claim button for Beneficiary before deadline expiration", () => {
      render(
        <EscrowCard
          escrow={sampleLockedEscrow} // deadline is 1 hr in future
          currentUserAddress={BENEFICIARY}
        />
      );

      expect(screen.getByText("You are Beneficiary")).toBeDefined();

      const claimBtn = screen.getByRole("button", { name: /Claim Escrow/i });
      expect(claimBtn).toBeDefined();
      expect(claimBtn.hasAttribute("disabled")).toBe(true);
    });

    it("enables Claim button for Beneficiary after deadline expiration and executes claimEscrow", async () => {
      mockClaimEscrow.mockResolvedValueOnce({
        success: true,
        txHash: "claim_tx_456",
      });

      const onUpdated = vi.fn();
      render(
        <EscrowCard
          escrow={sampleExpiredEscrow}
          currentUserAddress={BENEFICIARY}
          onUpdated={onUpdated}
        />
      );

      const claimBtn = screen.getByRole("button", { name: /Claim Escrow/i });
      expect(claimBtn.hasAttribute("disabled")).toBe(false);

      fireEvent.click(claimBtn);

      await waitFor(() => {
        expect(mockClaimEscrow).toHaveBeenCalledWith(BENEFICIARY, 101);
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("successfully claimed by beneficiary"),
          "success"
        );
        expect(onUpdated).toHaveBeenCalled();
      });
    });

    it("displays arbiter resolution buttons and executes releaseByArbiter", async () => {
      mockReleaseByArbiter.mockResolvedValueOnce({
        success: true,
        txHash: "arbiter_tx_789",
      });

      const onUpdated = vi.fn();
      render(
        <EscrowCard
          escrow={sampleLockedEscrow}
          currentUserAddress={ARBITER}
          onUpdated={onUpdated}
        />
      );

      expect(screen.getByText("You are Arbiter")).toBeDefined();

      const releaseToBeneficiaryBtn = screen.getByRole("button", {
        name: /Release to Beneficiary/i,
      });
      const refundToDepositorBtn = screen.getByRole("button", {
        name: /Refund to Depositor/i,
      });

      expect(releaseToBeneficiaryBtn).toBeDefined();
      expect(refundToDepositorBtn).toBeDefined();

      fireEvent.click(releaseToBeneficiaryBtn);

      await waitFor(() => {
        expect(mockReleaseByArbiter).toHaveBeenCalledWith(ARBITER, 101, true);
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("released funds to beneficiary"),
          "success"
        );
        expect(onUpdated).toHaveBeenCalled();
      });
    });

    it("surfaces contract errors when an action fails", async () => {
      mockReleaseEscrow.mockResolvedValueOnce({
        success: false,
        error: "Contract execution failed: EscrowAlreadyReleased",
      });

      render(
        <EscrowCard
          escrow={sampleLockedEscrow}
          currentUserAddress={DEPOSITOR}
        />
      );

      const releaseBtn = screen.getByRole("button", {
        name: /Release Early to Beneficiary/i,
      });
      fireEvent.click(releaseBtn);

      await waitFor(() => {
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("EscrowAlreadyReleased"),
          "error"
        );
        expect(screen.getByText(/EscrowAlreadyReleased/)).toBeDefined();
      });
    });

    it("does not show action buttons to non-participant observers", () => {
      render(
        <EscrowCard
          escrow={sampleLockedEscrow}
          currentUserAddress={OBSERVER}
        />
      );

      expect(
        screen.queryByRole("button", { name: /Release Early/i })
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /Claim Escrow/i })).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Release to Beneficiary/i })
      ).toBeNull();
    });
  });
});
