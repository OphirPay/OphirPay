// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecurringPage from "@/app/recurring/page";
import * as priceModule from "@/lib/price";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const mockUseApiQuery = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: { connected: true, publicKey: VALID_ADDRESS },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: (addr: string) => /^G[A-Z0-9]{55}$/.test(addr),
}));

const mockRecurrences = [
  {
    id: "rec_1",
    name: "Monthly SaaS",
    frequency: "MONTHLY",
    amount: "50",
    assetCode: "XLM",
    destAddress: VALID_ADDRESS,
    description: null,
    isActive: true,
    nextRunAt: "2026-10-01T00:00:00.000Z",
    lastRunAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecurringPage />
    </QueryClientProvider>
  );
}

describe("RecurringPage - Fiat Display Toggle (XLM ↔ USD)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    mockUseApiQuery.mockImplementation((key: string[]) =>
      key[0] === "recurring"
        ? { data: mockRecurrences, isLoading: false }
        : { data: [], isLoading: false }
    );
  });

  it("renders amounts in XLM mode by default", () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
    });

    renderPage();

    const xlmButton = screen.getByRole("button", { name: /display amounts in xlm/i });
    expect(xlmButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
  });

  it("switches to USD mode on toggle click and renders the converted amount", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15, // 50 XLM * 0.15 = $7.50
      source: "coingecko",
    });

    renderPage();

    const usdButton = screen.getByRole("button", { name: /display amounts in usd/i });
    fireEvent.click(usdButton);

    await waitFor(() => {
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("~$7.50")).toBeInTheDocument();
      // Original XLM amount stays visible as subtitle.
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    });

    // Preference persists via the shared storage key.
    expect(JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')).toBe(
      "USD"
    );
  });

  it("falls back visibly to the asset unit when the price is unavailable in USD mode", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: null,
      source: null,
      error: "All price feeds offline",
    });

    window.localStorage.setItem("ophirpay-currency-display", JSON.stringify("USD"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
    });
  });
});
