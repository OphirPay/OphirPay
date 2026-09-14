// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentDetailPage from "@/app/payments/[id]/page";
import type { OnChainPayment } from "@/lib/contracts";
import { shortenAddress } from "@/lib/utils";

let paramId = "1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: paramId }),
}));

const fetchOnChainPaymentMock = vi.fn();

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayment: (id: number) => fetchOnChainPaymentMock(id),
}));

const CONFIRMED_PAYMENT: OnChainPayment = {
  id: 1,
  payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  amountStroops: 15000000, // 1.5 XLM
  txHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  timestamp: 1700000000,
  metadata: "RECORDED",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentDetailPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  paramId = "1";
  fetchOnChainPaymentMock.mockReset();
  // Default: DB route is unauthenticated (401) — the page must still render
  // from on-chain data alone.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "Authentication required" } }, 401)
    )
  );
});

describe("PaymentDetailPage", () => {
  it("shows a loading skeleton while the on-chain read is in flight", () => {
    fetchOnChainPaymentMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status", { name: /loading payment/i })).toBeInTheDocument();
  });

  it("renders payment fields, memo, tx hash, and a confirmed timeline", async () => {
    fetchOnChainPaymentMock.mockResolvedValue(CONFIRMED_PAYMENT);
    renderPage();

    // Wait for the detail content (the breadcrumb renders immediately)
    expect(await screen.findByText("1.50 XLM")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Payment #1" })).toBeInTheDocument();
    expect(screen.getByText(/^GAAAAAAAA\.\.\.AAAAAAAA$/)).toBeInTheDocument();
    expect(screen.getByText(/^GBBBBBBBB\.\.\.BBBBBBBB$/)).toBeInTheDocument();
    // Explorer link for the tx hash
    const explorer = screen.getByRole("link", {
      name: shortenAddress(CONFIRMED_PAYMENT.txHash, 8),
    });
    expect(explorer).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
    );
    // Lifecycle renders the confirmed terminal step
    expect(screen.getByText("Lifecycle")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on explorer/i })).toBeInTheDocument();
  });

  it("renders the DB memo when an authenticated session provides it", async () => {
    fetchOnChainPaymentMock.mockResolvedValue(CONFIRMED_PAYMENT);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            id: "1",
            amount: "1.5",
            assetCode: "XLM",
            memo: "Invoice #42",
            description: "Consulting services",
            status: "CONFIRMED",
            transactionHash: CONFIRMED_PAYMENT.txHash,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
            completedAt: "2024-01-02T00:00:00Z",
          },
        })
      )
    );
    renderPage();

    expect(await screen.findByText("Invoice #42")).toBeInTheDocument();
    expect(screen.getByText("Consulting services")).toBeInTheDocument();
  });

  it("renders a not-found state for unknown ids", async () => {
    fetchOnChainPaymentMock.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText("Payment not found")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to payments/i })
    ).toHaveAttribute("href", "/payments");
  });

  it("treats unsafe u64 ids (beyond MAX_SAFE_INTEGER) as not found", async () => {
    // u64 ids lose precision above Number.MAX_SAFE_INTEGER — never look up a
    // lossy-converted id that could resolve to the wrong record.
    paramId = "9007199254740993";
    fetchOnChainPaymentMock.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText("Payment not found")).toBeInTheDocument();
    expect(fetchOnChainPaymentMock).not.toHaveBeenCalled();
  });

  it("renders an error state with retry when the read fails", async () => {
    fetchOnChainPaymentMock.mockRejectedValue(new Error("RPC unreachable"));
    renderPage();

    expect(
      await screen.findByText(/failed to load this payment/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders a DB-only payment (cuid id) without an on-chain record", async () => {
    paramId = "clx1234abcd";
    fetchOnChainPaymentMock.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            id: "clx1234abcd",
            amount: "250",
            assetCode: "XLM",
            memo: "Monthly retainer",
            status: "SUBMITTED",
            createdAt: "2024-01-01T00:00:00Z",
          },
        })
      )
    );
    renderPage();

    // Wait for the detail content (the breadcrumb renders immediately)
    expect(await screen.findByText("250.00 XLM")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Payment #clx1234abcd" })
    ).toBeInTheDocument();
    expect(screen.getByText("Monthly retainer")).toBeInTheDocument();
    // SUBMITTED position is current
    expect(screen.getByText("Transaction submitted to the network")).toBeInTheDocument();
  });
});
