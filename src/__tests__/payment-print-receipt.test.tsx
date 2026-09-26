// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentDetailPage from "@/app/payments/[id]/page";
import PaymentReceiptPage from "@/app/payments/[id]/receipt/page";

const mockUseApiQuery = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayment: vi.fn(),
}));

const mockOnChainPayment = {
  id: 42,
  payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  amountStroops: 250000000, // 25 XLM
  txHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  timestamp: 1700000000,
  metadata: "Bounty payment for documentation",
};

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe("Payment Detail Page - Print Support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockImplementation((key: string[]) => {
      if (key[0] === "payments" && key[1] === "onchain") {
        return { data: mockOnChainPayment, isLoading: false, isError: false };
      }
      return { data: null, isLoading: false, isError: false };
    });
  });

  it("renders a print button that triggers window.print", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderWithQuery(<PaymentDetailPage />);

    const printButton = screen.getByRole("button", { name: /print/i });
    expect(printButton).toBeInTheDocument();
    expect(printButton).toHaveClass("no-print");

    fireEvent.click(printButton);
    expect(printSpy).toHaveBeenCalled();
  });

  it("renders a link to the dedicated receipt route", () => {
    renderWithQuery(<PaymentDetailPage />);

    const receiptLink = screen.getByRole("link", { name: /receipt/i });
    expect(receiptLink).toBeInTheDocument();
    expect(receiptLink).toHaveAttribute("href", "/payments/42/receipt");
    expect(receiptLink).toHaveClass("no-print");
  });

  it("includes print-only official header with record ID", () => {
    renderWithQuery(<PaymentDetailPage />);

    const printHeaders = screen.getAllByText(/OphirPay Payment Record/i);
    expect(printHeaders.length).toBeGreaterThan(0);
    expect(screen.getByText(/Record #42/i)).toBeInTheDocument();
  });

  it("exposes full payer, payee, and transaction hash in print elements", () => {
    renderWithQuery(<PaymentDetailPage />);

    // Payer and Payee full addresses exist in the DOM with print-only class
    expect(screen.getByText(mockOnChainPayment.payer)).toHaveClass("print-only");
    expect(screen.getByText(mockOnChainPayment.payee)).toHaveClass("print-only");
    expect(screen.getByText(mockOnChainPayment.txHash)).toHaveClass("print-only");
  });
});

describe("Payment Receipt Page (/payments/[id]/receipt)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockImplementation((key: string[]) => {
      if (key[0] === "payments" && key[1] === "onchain") {
        return { data: mockOnChainPayment, isLoading: false, isError: false };
      }
      return { data: null, isLoading: false, isError: false };
    });
  });

  it("renders official payment receipt details", () => {
    renderWithQuery(<PaymentReceiptPage />);

    expect(screen.getByText("PAYMENT RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("Receipt #42")).toBeInTheDocument();
    expect(screen.getByText("25.00 XLM")).toBeInTheDocument();
    expect(screen.getByText(mockOnChainPayment.payer)).toBeInTheDocument();
    expect(screen.getByText(mockOnChainPayment.payee)).toBeInTheDocument();
    expect(screen.getByText(mockOnChainPayment.txHash)).toBeInTheDocument();
    expect(screen.getByText(/Bounty payment for documentation/)).toBeInTheDocument();
  });

  it("provides a Print Receipt button that triggers window.print", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderWithQuery(<PaymentReceiptPage />);

    const printBtn = screen.getByRole("button", { name: /print receipt/i });
    expect(printBtn).toBeInTheDocument();

    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();
  });
});
