// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FeeSelector } from "@/components/ui/FeeSelector";
import { PaymentForm } from "@/components/forms/payment-form";
import { stroopsToXlm } from "@/hooks/useFeeStats";

// Mock the fee stats fetcher to return deterministic values
vi.mock("@/lib/fee-stats", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/fee-stats");
  return {
    ...actual,
    defaultFeeStatsFetcher: vi.fn(async () => ({
      last_ledger_base_fee: 100,
      ledger_capacity_usage: 0.25,
      fee_charged: {
        min: 100,
        mode: 100,
        p10: 100,
        p20: 100,
        p40: 100,
        p50: 120,
        p60: 140,
        p70: 160,
        p80: 180,
        p90: 200,
        p95: 250,
        p99: 400,
        max: 500,
      },
      max_fee: {
        min: 100,
        mode: 100,
        p10: 100,
        p20: 100,
        p40: 100,
        p50: 120,
        p60: 140,
        p70: 160,
        p80: 180,
        p90: 200,
        p95: 250,
        p99: 400,
        max: 500,
      },
      last_ledger: 500000,
    })),
  };
});

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

describe("Fee Estimation & Selector Widget (#1373)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("stroopsToXlm conversion", () => {
    it("converts base 100 stroops to 0.00001 XLM", () => {
      expect(stroopsToXlm(100)).toBe("0.00001");
    });

    it("converts 10,000,000 stroops to 1 XLM", () => {
      expect(stroopsToXlm(10_000_000)).toBe("1");
    });

    it("converts 150 stroops to 0.000015 XLM", () => {
      expect(stroopsToXlm(150)).toBe("0.000015");
    });
  });

  describe("<FeeSelector /> Component", () => {
    it("renders all three fee tiers and custom option", async () => {
      const onChange = vi.fn();
      await act(async () => {
        render(<FeeSelector selectedFee={150} onChange={onChange} />);
      });

      expect(screen.getByTestId("fee-tier-low")).toBeDefined();
      expect(screen.getByTestId("fee-tier-recommended")).toBeDefined();
      expect(screen.getByTestId("fee-tier-fast")).toBeDefined();
      expect(screen.getByTestId("fee-tier-custom-btn")).toBeDefined();
    });

    it("allows switching to Low tier and triggers callback", async () => {
      const onChange = vi.fn();
      await act(async () => {
        render(<FeeSelector selectedFee={150} onChange={onChange} />);
      });

      const lowBtn = screen.getByTestId("fee-tier-low");
      await act(async () => {
        fireEvent.click(lowBtn);
      });

      expect(onChange).toHaveBeenCalledWith(expect.any(Number), "low");
    });

    it("allows switching to Fast tier and triggers callback", async () => {
      const onChange = vi.fn();
      await act(async () => {
        render(<FeeSelector selectedFee={150} onChange={onChange} />);
      });

      const fastBtn = screen.getByTestId("fee-tier-fast");
      await act(async () => {
        fireEvent.click(fastBtn);
      });

      expect(onChange).toHaveBeenCalledWith(expect.any(Number), "fast");
    });

    it("validates custom fee input against minimum base fee", async () => {
      const onChange = vi.fn();
      await act(async () => {
        render(<FeeSelector selectedFee={150} onChange={onChange} />);
      });

      // Switch to custom
      const customBtn = screen.getByTestId("fee-tier-custom-btn");
      await act(async () => {
        fireEvent.click(customBtn);
      });

      const input = screen.getByTestId("custom-fee-input");
      expect(input).toBeDefined();

      // Enter fee below 100 stroops
      await act(async () => {
        fireEvent.change(input, { target: { value: "50" } });
      });
      const errorMsg = screen.getByTestId("custom-fee-error");
      expect(errorMsg.textContent).toContain("Minimum network fee is 100 stroops");

      // Enter valid custom fee
      await act(async () => {
        fireEvent.change(input, { target: { value: "500" } });
      });
      expect(screen.queryByTestId("custom-fee-error")).toBeNull();
      expect(onChange).toHaveBeenCalledWith(500, "custom");
    });
  });

  describe("<PaymentForm /> Integration", () => {
    const validAddress = "GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO";

    it("submits payment payload containing selected fee and tier", async () => {
      const onSubmit = vi.fn();
      await act(async () => {
        render(
          <PaymentForm
            defaultDestination={validAddress}
            defaultAmount="25.5"
            onSubmit={onSubmit}
            isWalletConnected={true}
          />
        );
      });

      // Select fast tier
      const fastBtn = screen.getByTestId("fee-tier-fast");
      await act(async () => {
        fireEvent.click(fastBtn);
      });

      // Submit form
      const submitBtn = screen.getByTestId("submit-payment-btn");
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(onSubmit).toHaveBeenCalledWith({
        destination: validAddress,
        amount: "25.5",
        memo: undefined,
        fee: expect.any(Number),
        feeTier: "fast",
      });
    });

    it("displays error when destination address is invalid", async () => {
      const onSubmit = vi.fn();
      await act(async () => {
        render(
          <PaymentForm
            defaultDestination="INVALID_ADDRESS"
            defaultAmount="10"
            onSubmit={onSubmit}
            isWalletConnected={true}
          />
        );
      });

      const submitBtn = screen.getByTestId("submit-payment-btn");
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(screen.getByTestId("payment-form-error")).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
