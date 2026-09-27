// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BatchDetailPage from "@/app/batches/[id]/page";
import * as priceModule from "@/lib/price";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "batch_1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mockUseApiQuery = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mockBatch = {
  id: "batch_1",
  userId: "user_1",
  name: "Payroll October",
  status: "PARTIALLY_COMPLETED",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  description: "Monthly payroll",
  items: [
    { id: "item_1", amount: 25, assetCode: "XLM", status: "sent" },
    { id: "item_2", amount: 10, assetCode: "USDC", status: "pending" },
  ],
  progress: { total: 2, pending: 1, sent: 1, failed: 0, percentComplete: 50 },
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

describe("BatchDetailPage - Fiat Display Toggle (XLM ↔ USD)", () => {
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

  it("renders item amounts in their asset units by default", () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
    });

    renderPage();

    const xlmButton = screen.getByRole("button", { name: /display amounts in xlm/i });
    expect(xlmButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("25.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("10.00 USDC")).toBeInTheDocument();
  });

  it("converts XLM items in USD mode while non-XLM assets keep their unit", async () => {
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15, // 25 XLM * 0.15 = $3.75
      source: "coingecko",
    });

    renderPage();

    const usdButton = screen.getByRole("button", { name: /display amounts in usd/i });
    fireEvent.click(usdButton);

    await waitFor(() => {
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("~$3.75")).toBeInTheDocument();
      expect(screen.getByText("25.00 XLM")).toBeInTheDocument();
      // USDC has no XLM rate — it must keep its own asset unit explicitly.
      expect(screen.getByText("10.00 USDC")).toBeInTheDocument();
    });

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
      expect(screen.getByText("25.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("(USD unavailable)")).toBeInTheDocument();
      expect(screen.getByText("10.00 USDC")).toBeInTheDocument();
    });
  });
});
