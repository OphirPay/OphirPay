import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentDetailView, getStepStatus, PaymentRecord } from "@/app/payments/[id]/page";

const basePayment: PaymentRecord = {
  id: "pay_test123",
  amount: "150.0000000",
  assetCode: "XLM",
  description: "Consulting Invoice",
  memo: "INV-2026",
  status: "COMPLETED",
  transactionHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
  destAccountId: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:01:00.000Z",
  completedAt: "2026-08-26T12:01:00.000Z",
};

describe("getStepStatus Helper", () => {
  it("marks all steps as completed for COMPLETED payment", () => {
    expect(getStepStatus("CREATED", "COMPLETED")).toBe("completed");
    expect(getStepStatus("PROCESSING", "COMPLETED")).toBe("completed");
    expect(getStepStatus("SUBMITTED", "COMPLETED")).toBe("completed");
    expect(getStepStatus("COMPLETED", "COMPLETED")).toBe("completed");
  });

  it("marks CREATED completed and PROCESSING current for PENDING/PROCESSING status", () => {
    expect(getStepStatus("CREATED", "PENDING")).toBe("completed");
    expect(getStepStatus("PROCESSING", "PENDING")).toBe("current");
    expect(getStepStatus("SUBMITTED", "PENDING")).toBe("upcoming");
  });

  it("marks final step as failed for FAILED status", () => {
    expect(getStepStatus("CREATED", "FAILED")).toBe("completed");
    expect(getStepStatus("COMPLETED", "FAILED")).toBe("failed");
  });
});

describe("PaymentDetailView Component", () => {
  it("renders payment details, amounts, memo, and completed timeline", () => {
    render(<PaymentDetailView payment={basePayment} />);

    expect(screen.getByText("pay_test123")).toBeInTheDocument();
    expect(screen.getByText("150.0000000 XLM")).toBeInTheDocument();
    expect(screen.getByText("Consulting Invoice")).toBeInTheDocument();
    expect(screen.getByText("INV-2026")).toBeInTheDocument();
    expect(screen.getByText(/View on Stellar.Expert Explorer/i)).toBeInTheDocument();
  });

  it("renders error message and failed status badge when payment failed", () => {
    const failedPayment: PaymentRecord = {
      ...basePayment,
      status: "FAILED",
      errorMessage: "op_underfunded on source account",
    };

    render(<PaymentDetailView payment={failedPayment} />);

    expect(screen.getByText("FAILED")).toBeInTheDocument();
    expect(screen.getByText(/op_underfunded on source account/i)).toBeInTheDocument();
  });
});
