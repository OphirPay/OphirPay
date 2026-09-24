// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { StreamCard } from "@/components/streams/StreamCard";
import { VestingCurve } from "@/components/streams/VestingCurve";
import type { StreamRecord } from "@/lib/streams";

const RECIPIENT_ADDR = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CREATOR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OBSERVER_ADDR = "GCDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

const mockToastShow = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    show: mockToastShow,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

const mockClaimStream = vi.fn();
const mockCancelStream = vi.fn();
vi.mock("@/lib/contract-advanced", () => ({
  claimStream: (...args: unknown[]) => mockClaimStream(...args),
  cancelStream: (...args: unknown[]) => mockCancelStream(...args),
  createStream: vi.fn(),
}));

describe("Payment Stream UI Components", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sampleStream: StreamRecord = {
    id: 42,
    creator: CREATOR_ADDR,
    recipient: RECIPIENT_ADDR,
    totalAmount: "1000000000", // 100 XLM in stroops
    claimedAmount: "200000000", // 20 XLM in stroops
    asset: "native",
    startTime: nowSeconds - 3600, // 1 hour ago
    endTime: nowSeconds + 3600, // 1 hour from now (50% elapsed)
    cancelled: false,
    metadata: "Q3 Core Contributor Stream",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("VestingCurve", () => {
    it("renders progress percentage, live claimable, total locked, vested, claimed, and remaining amounts", () => {
      render(<VestingCurve stream={sampleStream} />);

      // Total locked should be displayed (100.00 XLM)
      expect(screen.getByText("Total Locked")).toBeDefined();
      expect(screen.getByText("100.00 XLM")).toBeDefined();

      // Earned (Vested) should be displayed
      expect(screen.getByText("Earned (Vested)")).toBeDefined();

      // Claimed should be displayed (20.00 XLM)
      expect(screen.getByText("Claimed")).toBeDefined();
      expect(screen.getByText("20.00 XLM")).toBeDefined();

      // Remaining unvested should be displayed
      expect(screen.getByText("Remaining Unvested")).toBeDefined();

      // Live Claimable should be displayed
      expect(screen.getByText("Live Claimable")).toBeDefined();
    });
  });

  describe("StreamCard Role-Gated Actions", () => {
    it("renders stream details and metadata memo", () => {
      render(
        <StreamCard
          stream={sampleStream}
          currentUserAddress={OBSERVER_ADDR}
        />
      );

      expect(screen.getByText("Stream #42")).toBeDefined();
      expect(screen.getByText(/Q3 Core Contributor Stream/)).toBeDefined();
      expect(screen.getByText("ACTIVE")).toBeDefined();
    });

    it("displays Claim button for the recipient and executes claimStream on click", async () => {
      mockClaimStream.mockResolvedValueOnce({
        success: true,
        txHash: "abcdef1234567890",
      });

      const onUpdated = vi.fn();
      render(
        <StreamCard
          stream={sampleStream}
          currentUserAddress={RECIPIENT_ADDR}
          onUpdated={onUpdated}
        />
      );

      // Recipient badge should be visible
      expect(screen.getByText("Recipient (Incoming)")).toBeDefined();

      // Claim button should be present
      const claimBtn = screen.getByRole("button", { name: /Claim/i });
      expect(claimBtn).toBeDefined();
      expect(claimBtn.hasAttribute("disabled")).toBe(false);

      fireEvent.click(claimBtn);

      await waitFor(() => {
        expect(mockClaimStream).toHaveBeenCalledWith(RECIPIENT_ADDR, 42);
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("Successfully claimed tokens from Stream #42"),
          "success"
        );
        expect(onUpdated).toHaveBeenCalled();
      });
    });

    it("displays Cancel button for the creator and executes cancelStream on click", async () => {
      mockCancelStream.mockResolvedValueOnce({
        success: true,
        txHash: "1234567890abcdef",
      });

      const onUpdated = vi.fn();
      render(
        <StreamCard
          stream={sampleStream}
          currentUserAddress={CREATOR_ADDR}
          onUpdated={onUpdated}
        />
      );

      // Creator badge should be visible
      expect(screen.getByText("Creator (Outgoing)")).toBeDefined();

      // Cancel button should be present
      const cancelBtn = screen.getByRole("button", { name: /Cancel Stream/i });
      expect(cancelBtn).toBeDefined();

      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(mockCancelStream).toHaveBeenCalledWith(CREATOR_ADDR, 42);
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("Stream #42 successfully cancelled"),
          "success"
        );
        expect(onUpdated).toHaveBeenCalled();
      });
    });

    it("surfaces on-chain contract errors when a claim fails", async () => {
      mockClaimStream.mockResolvedValueOnce({
        success: false,
        error: "Contract execution failed: StreamFullyClaimed",
      });

      render(
        <StreamCard
          stream={sampleStream}
          currentUserAddress={RECIPIENT_ADDR}
        />
      );

      const claimBtn = screen.getByRole("button", { name: /Claim/i });
      fireEvent.click(claimBtn);

      await waitFor(() => {
        expect(mockToastShow).toHaveBeenCalledWith(
          expect.stringContaining("StreamFullyClaimed"),
          "error"
        );
        expect(screen.getByText(/StreamFullyClaimed/)).toBeDefined();
      });
    });

    it("does not show action buttons to third-party observers", () => {
      render(
        <StreamCard
          stream={sampleStream}
          currentUserAddress={OBSERVER_ADDR}
        />
      );

      expect(screen.queryByRole("button", { name: /Claim/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Cancel Stream/i })).toBeNull();
    });
  });
});
