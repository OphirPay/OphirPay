// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";
import * as priceModule from "@/lib/price";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
    payments: [
      {
        id: 1,
        payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        amountStroops: 100000000, // 10 XLM
        txHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        timestamp: 1700000000,
      },
    ],
    total: 1,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>
  );
}

describe("PaymentsPage - Fiat Display Toggle (XLM ↔ USD)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders amounts in XLM mode by default", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
    });

    renderPage();

    // Verify toggle exists and has XLM pressed
    const xlmButton = await screen.findByRole("button", {
      name: /display amounts in xlm/i,
    });
    expect(xlmButton).toHaveAttribute("aria-pressed", "true");

    // Check table header and row amount
    expect(screen.getByText(/Amount \(XLM\)/i)).toBeInTheDocument();
    expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
  });

  it("switches to USD mode on toggle click and renders converted amount", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15, // 10 XLM * 0.15 = $1.50
      source: "coingecko",
    });

    renderPage();

    const usdButton = await screen.findByRole("button", {
      name: /display amounts in usd/i,
    });

    fireEvent.click(usdButton);

    await waitFor(() => {
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(/Amount \(USD\)/i)).toBeInTheDocument();
      expect(screen.getByText("~$1.50")).toBeInTheDocument();
      // Also displays original XLM as subtitle
      expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
    });

    // Check localStorage persistence
    expect(JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')).toBe(
      "USD"
    );
  });

  it("renders graceful fallback when price is unavailable in USD mode", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: null,
      source: null,
      error: "All price feeds offline",
    });

    // Set initial localStorage to USD
    window.localStorage.setItem("ophirpay-currency-display", JSON.stringify("USD"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("10.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
    });
  });
});
