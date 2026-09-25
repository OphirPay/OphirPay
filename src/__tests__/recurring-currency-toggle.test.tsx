// SPDX-License-Identifier: MIT

// Recurring view honors the persisted currency preference (issue #795):
// XLM by default, fiat conversion on toggle, explicit asset fallback.

import type React from "react";
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
    wallet: { connected: true, publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
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
      <RecurringPage />
    </QueryClientProvider>
  );
}

describe("RecurringPage - Fiat Display Toggle (issue #795)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    mockUseApiQuery.mockImplementation((key: string[]) =>
      key[0] === "recurring"
        ? { data: mockRecurrences, isLoading: false }
        : { data: [], isLoading: false }
    );
    vi.spyOn(priceModule, "fetchXlmPrice").mockResolvedValue({
      price: 0.15,
      source: "coingecko",
    } as never);
  });

  it("renders the toggle and amounts in XLM by default", async () => {
    renderPage();

    const usdButton = await screen.findByRole("button", {
      name: /display amounts in usd/i,
    });
    expect(usdButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
  });

  it("converts the schedule amount to fiat on toggle", async () => {
    renderPage();

    const usdButton = await screen.findByRole("button", {
      name: /display amounts in usd/i,
    });
    fireEvent.click(usdButton);

    // 50 XLM @ $0.15 — fiat primary, XLM kept as subline.
    await waitFor(() => {
      expect(usdButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("~$7.50")).toBeInTheDocument();
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    });
  });
});
