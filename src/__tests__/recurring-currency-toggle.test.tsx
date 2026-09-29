// SPDX-License-Identifier: MIT
// Issue #795 — currency display toggle on the Recurring Payments page.
//
// Verifies that amounts on the recurring page respect the persisted XLM ↔ USD
// preference, with a graceful fallback when the price feed is unavailable.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import RecurringPage from "@/app/recurring/page";
import * as priceModule from "@/lib/price";

// ── Minimal mocks ─────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/recurring",
  useSearchParams: () => new URLSearchParams(""),
}));

// Wallet — connected but balance loading irrelevant here
vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      balance: "5000",
      balanceLoading: false,
      network: "TESTNET",
    },
    fetchBalance: vi.fn(),
  }),
}));

// API query — return a single active recurrence paying 100 XLM/month
vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: vi.fn().mockReturnValue({
    data: [
      {
        id: "rec-1",
        name: "Monthly Salary",
        frequency: "MONTHLY",
        amount: "100",
        assetCode: "XLM",
        destAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        description: null,
        isActive: true,
        nextRunAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        lastRunAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
    isLoading: false,
  }),
  useApiMutation: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RecurringPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────

describe("RecurringPage — currency display toggle (issue #795)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders amounts in XLM by default", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.10,
      source: "coingecko",
      timestamp: Date.now(),
    });

    renderPage();

    // The recurring card should show 100.00 XLM
    await waitFor(() => {
      expect(screen.getByText(/100\.00 XLM/i)).toBeInTheDocument();
    });

    // Toggle should be present and XLM pressed
    const xlmBtn = screen.getByRole("button", { name: /display amounts in xlm/i });
    expect(xlmBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to USD and shows converted amount", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.10, // 100 XLM * $0.10 = $10.00
      source: "coingecko",
      timestamp: Date.now(),
    });

    renderPage();

    const usdBtn = await screen.findByRole("button", { name: /display amounts in usd/i });
    fireEvent.click(usdBtn);

    await waitFor(() => {
      expect(usdBtn).toHaveAttribute("aria-pressed", "true");
      // Should show the fiat value (~$10.00) plus the original XLM
      expect(screen.getByText(/\$10\.00/)).toBeInTheDocument();
      expect(screen.getByText(/100\.00 XLM/i)).toBeInTheDocument();
    });

    // Preference should be persisted
    expect(
      JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')
    ).toBe("USD");
  });

  it("shows graceful fallback when price feed is unavailable in USD mode", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: null,
      source: null,
      error: "All price feeds offline",
    });

    // Pre-set USD preference
    window.localStorage.setItem(
      "ophirpay-currency-display",
      JSON.stringify("USD")
    );

    renderPage();

    await waitFor(() => {
      // Should still show the XLM amount
      expect(screen.getByText(/100\.00 XLM/i)).toBeInTheDocument();
      // And the unavailability notice
      expect(screen.getByText(/USD unavailable/i)).toBeInTheDocument();
    });
  });
});
