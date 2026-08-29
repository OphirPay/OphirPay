// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentDetailView from "@/app/payments/[id]/PaymentDetailView";
import { PaymentLifecycleTimeline } from "@/components/PaymentLifecycleTimeline";
import type { Payment } from "@/types";

const fetchMock = vi.fn();
let resolveFetch: ((value: unknown) => void) | null = null;

const VALID_ID = "cm1234567890123456789012";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderView(id: string = VALID_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentDetailView id={id} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  resolveFetch = null;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);
});

describe("Payment Detail View & Lifecycle Timeline Components", () => {
  it("renders CREATED payment status lifecycle", async () => {
    const createdPayment: Payment = {
      id: VALID_ID,
      amount: 100,
      status: "CREATED",
      assetCode: "XLM",
      memo: "memo-test-123",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };

    renderView();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: createdPayment }));
    });

    expect(await screen.findByText("100.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("memo-test-123")).toBeInTheDocument();
    expect(screen.getByTestId("payment-lifecycle-timeline")).toBeInTheDocument();

    const createdStep = screen.getByTestId("timeline-step-created");
    expect(createdStep).toHaveTextContent("Created");
    expect(createdStep).toHaveTextContent("completed");

    const signedStep = screen.getByTestId("timeline-step-signed");
    expect(signedStep).toHaveTextContent("Signed");
    expect(signedStep).toHaveTextContent("upcoming");

    const submittedStep = screen.getByTestId("timeline-step-submitted");
    expect(submittedStep).toHaveTextContent("Submitted");
    expect(submittedStep).toHaveTextContent("upcoming");

    const confirmedStep = screen.getByTestId("timeline-step-confirmed");
    expect(confirmedStep).toHaveTextContent("Confirmed");
    expect(confirmedStep).toHaveTextContent("upcoming");
  });

  it("renders SIGNED payment status lifecycle", async () => {
    const signedPayment: Payment = {
      id: VALID_ID,
      amount: 50,
      status: "SIGNED",
      assetCode: "USDC",
      description: "Payroll June",
      memo: "invoice-99",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:05:00.000Z",
    };

    renderView();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: signedPayment }));
    });

    expect(await screen.findByText("50.00 USDC")).toBeInTheDocument();
    expect(screen.getByText("Payroll June")).toBeInTheDocument();
    expect(screen.getByText("invoice-99")).toBeInTheDocument();

    const signedStep = screen.getByTestId("timeline-step-signed");
    expect(signedStep).toHaveTextContent("Signed");
    expect(signedStep).toHaveTextContent("completed");
  });

  it("renders SUBMITTED payment status with txHash and Stellar explorer link", async () => {
    const txHash =
      "4b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c";
    const submittedPayment: Payment = {
      id: VALID_ID,
      amount: 75.5,
      status: "SUBMITTED",
      assetCode: "XLM",
      transactionHash: txHash,
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:15:00.000Z",
    };

    renderView();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: submittedPayment }));
    });

    expect(await screen.findByText("75.50 XLM")).toBeInTheDocument();

    const submittedStep = screen.getByTestId("timeline-step-submitted");
    expect(submittedStep).toHaveTextContent("Submitted");
    expect(submittedStep).toHaveTextContent("completed");

    // Explorer links on both timeline and details table
    const explorerLinks = screen.getAllByTitle("View transaction on Stellar Explorer");
    expect(explorerLinks.length).toBeGreaterThan(0);
    expect(explorerLinks[0]).toHaveAttribute("href", expect.stringContaining(txHash));
  });

  it("renders CONFIRMED / COMPLETED payment lifecycle with completedAt timestamp", async () => {
    const txHash =
      "9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff";
    const completedPayment: Payment = {
      id: VALID_ID,
      amount: 1000,
      status: "COMPLETED",
      assetCode: "XLM",
      transactionHash: txHash,
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:20:00.000Z",
      completedAt: "2026-08-20T10:20:00.000Z",
    };

    renderView();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: completedPayment }));
    });

    expect(await screen.findByText("1,000.00 XLM")).toBeInTheDocument();

    const confirmedStep = screen.getByTestId("timeline-step-confirmed");
    expect(confirmedStep).toHaveTextContent("Confirmed");
    expect(confirmedStep).toHaveTextContent("completed");
    expect(confirmedStep).toHaveTextContent("Transaction confirmed on-chain in ledger");
  });

  it("renders FAILED payment lifecycle with error message box", async () => {
    const failedPayment: Payment = {
      id: VALID_ID,
      amount: 25,
      status: "FAILED",
      assetCode: "XLM",
      errorMessage: "op_underfunded: Source account lacks reserve",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:02:00.000Z",
    };

    renderView();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: failedPayment }));
    });

    expect(await screen.findByText("25.00 XLM")).toBeInTheDocument();

    const failedStep = screen.getByTestId("timeline-step-failed");
    expect(failedStep).toHaveTextContent("Failed");
    expect(failedStep).toHaveTextContent("failed");
    expect(screen.getByTestId("timeline-error-box")).toHaveTextContent(
      "op_underfunded: Source account lacks reserve"
    );
  });

  it("renders CANCELLED payment lifecycle", async () => {
    const cancelledPayment: Payment = {
      id: VALID_ID,
      amount: 10,
      status: "CANCELLED",
      assetCode: "XLM",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:01:00.000Z",
    };

    renderView();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: cancelledPayment }));
    });

    expect(await screen.findByText("10.00 XLM")).toBeInTheDocument();

    const cancelledStep = screen.getByTestId("timeline-step-cancelled");
    expect(cancelledStep).toHaveTextContent("Cancelled");
    expect(cancelledStep).toHaveTextContent("cancelled");
  });

  it("renders audit log evidence when metadata contains audit events", () => {
    const paymentWithAudits: Payment = {
      id: VALID_ID,
      amount: 500,
      status: "CONFIRMED",
      assetCode: "XLM",
      metadata: JSON.stringify({
        audits: [
          { kind: "SignatureAudit", valid: true, note: "Ed25519 signature verified" },
          { kind: "HorizonIngestionAudit", details: "Ledger sequence 458123 close" },
        ],
      }),
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:20:00.000Z",
    };

    render(<PaymentLifecycleTimeline payment={paymentWithAudits} />);

    expect(screen.getByTestId("audit-log-section")).toBeInTheDocument();
    expect(screen.getByText("SignatureAudit")).toBeInTheDocument();
    expect(screen.getByText("(Ed25519 signature verified)")).toBeInTheDocument();
    expect(screen.getByText("HorizonIngestionAudit")).toBeInTheDocument();
    expect(screen.getByText("— Ledger sequence 458123 close")).toBeInTheDocument();
  });
});
