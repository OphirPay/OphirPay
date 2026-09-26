// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import RecurringPage from "@/app/recurring/page";
import * as priceModule from "@/lib/price";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (url: unknown, opts: { method?: string } = {}) => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    method: opts.method ?? "POST",
  }),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: { connected: true, publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: (addr: string) => /^G[A-Z0-9]{55}$/.test(addr),
}));

const mockRecurrences = [
  {
    id: "rec_1",
    name: "Infrastructure Subscription",
    frequency: "MONTHLY",
    amount: "50",
    assetCode: "XLM",
    destAddress: VALID_ADDRESS,
    description: null,
    isActive: true,
    nextRunAt: "2026-10-01T00:00:00.000Z",
    lastRunAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

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

describe("RecurringPage - Currency Display Toggle (XLM ↔ USD)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    mockUseApiQuery.mockImplementation((key: string[]) =>
      key[0] === "recurring"
        ? { data: mockRecurrences, isLoading: false }
        : { data: [], isLoading: false }
    );
  });

  it("renders recurring amounts in XLM mode by default", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
    });

    renderPage();

    // Verify toggle exists and has XLM active
    const xlmButton = await screen.findByRole("button", {
      name: /display amounts in xlm/i,
    });
    expect(xlmButton).toHaveAttribute("aria-pressed", "true");

    // Check recurring card amount
    expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
  });

  it("switches to USD mode on toggle click, converts amount, and persists to localStorage", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15, // 50 XLM * 0.15 = $7.50
      source: "coingecko",
    });

    renderPage();

    const usdButton = await screen.findByRole("button", {
      name: /display amounts in usd/i,
    });

    fireEvent.click(usdButton);

    await waitFor(() => {
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("~$7.50")).toBeInTheDocument();
      // Original XLM amount shown as subtitle
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    });

    // Check localStorage persistence
    expect(JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')).toBe(
      "USD"
    );
  });

  it("respects persisted USD currency preference on initial load", async () => {
    window.localStorage.setItem("ophirpay-currency-display", JSON.stringify("USD"));
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.2, // 50 XLM * 0.20 = $10.00
      source: "coingecko",
    });

    renderPage();

    await waitFor(() => {
      const usdButton = screen.getByRole("button", {
        name: /display amounts in usd/i,
      });
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("~$10.00")).toBeInTheDocument();
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    });
  });

  it("renders graceful fallback visibly to asset unit when price is unavailable in USD mode", async () => {
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
