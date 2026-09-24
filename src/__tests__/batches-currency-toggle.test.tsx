// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BatchDetailPage from "@/app/batches/[id]/page";
import * as priceModule from "@/lib/price";

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockMutate = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "batch_123" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

const mockBatch = {
  id: "batch_123",
  name: "Contributor Payroll",
  status: "COMPLETED",
  createdAt: "2026-09-01T12:00:00.000Z",
  completedAt: "2026-09-01T12:05:00.000Z",
  totalPayments: 2,
  completedCount: 2,
  failedCount: 0,
  pendingCount: 0,
  items: [
    {
      id: "item_1",
      destination: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: 100,
      assetCode: "XLM",
      status: "COMPLETED",
      memo: "Dev bounty",
      errorMessage: null,
    },
    {
      id: "item_2",
      destination: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      amount: 50,
      assetCode: "XLM",
      status: "COMPLETED",
      memo: "Docs bounty",
      errorMessage: null,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BatchDetailPage />
    </QueryClientProvider>
  );
}

describe("BatchDetailPage - Currency Display Toggle (XLM ↔ USD)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    mockUseApiQuery.mockReturnValue({
      data: mockBatch,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("renders batch total and item amounts in XLM mode by default", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
    });

    renderPage();

    const xlmButton = await screen.findByRole("button", {
      name: /display amounts in xlm/i,
    });
    expect(xlmButton).toHaveAttribute("aria-pressed", "true");

    // Table header indicates XLM
    expect(screen.getByText("Amount (XLM)")).toBeInTheDocument();

    // Check item amounts and total volume
    expect(screen.getByText("100.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("150.00 XLM")).toBeInTheDocument();
  });

  it("switches to USD mode on toggle click and renders converted amounts", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.1, // 100 * 0.10 = $10.00, 50 * 0.10 = $5.00, 150 * 0.10 = $15.00
      source: "coingecko",
    });

    renderPage();

    const usdButton = await screen.findByRole("button", {
      name: /display amounts in usd/i,
    });

    fireEvent.click(usdButton);

    await waitFor(() => {
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Amount (USD)")).toBeInTheDocument();
      expect(screen.getByText("~$15.00")).toBeInTheDocument();
      expect(screen.getByText("~$10.00")).toBeInTheDocument();
      expect(screen.getByText("~$5.00")).toBeInTheDocument();
      // Original subtitles
      expect(screen.getByText("150.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("100.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    });

    expect(JSON.parse(window.localStorage.getItem("ophirpay-currency-display") || '""')).toBe(
      "USD"
    );
  });

  it("visibly falls back to asset unit and shows (USD unavailable) when price is unavailable", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: null,
      source: null,
      error: "All price feeds offline",
    });

    window.localStorage.setItem("ophirpay-currency-display", JSON.stringify("USD"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Amount (USD)")).toBeInTheDocument();
      expect(screen.getByText("150.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("100.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
      // Expect multiple (USD unavailable) tags for total volume and items
      const unavailableBadges = screen.getAllByText("(USD unavailable)");
      expect(unavailableBadges.length).toBeGreaterThanOrEqual(1);
    });
  });
});
