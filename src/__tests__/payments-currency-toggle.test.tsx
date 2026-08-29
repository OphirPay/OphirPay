// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";

const { mockPayments } = vi.hoisted(() => ({
  mockPayments: [
    {
      id: 1,
      payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      amountStroops: 10000000, // 1 XLM
      txHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      timestamp: 1700000000,
    },
    {
      id: 2,
      payer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      payee: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
      amountStroops: 500000000, // 50 XLM
      txHash: "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0",
      timestamp: 1700000100,
    },
  ],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
    payments: mockPayments,
    total: 2,
  }),
}));

let mockPriceResponse: { ok: boolean; json: () => Promise<Record<string, unknown>> } = {
  ok: true,
  json: async () => ({ price: 0.12, source: "coingecko" }),
};


function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>
  );
}

describe("PaymentsPage Currency Display Toggle", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    mockPriceResponse = {
      ok: true,
      json: async () => ({ price: 0.12, source: "coingecko" }),
    };
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/price")) {
        return mockPriceResponse as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.localStorage.clear();
  });

  it("renders payment amounts in XLM by default", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("1.00 XLM")).toBeInTheDocument();
      expect(screen.getByText("50.00 XLM")).toBeInTheDocument();
    });

    const xlmRadio = screen.getByRole("radio", { name: /display in xlm/i });
    expect(xlmRadio).toHaveAttribute("aria-checked", "true");
  });

  it("switches to USD display mode when toggle is clicked and price feed is available", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("1.00 XLM")).toBeInTheDocument();
    });

    const usdRadio = screen.getByRole("radio", { name: /display in usd/i });
    await user.click(usdRadio);

    await waitFor(() => {
      // 1 XLM * $0.12 = $0.12
      // 50 XLM * $0.12 = $6.00
      expect(screen.getByText("$0.12")).toBeInTheDocument();
      expect(screen.getByText("$6.00")).toBeInTheDocument();
    });

    expect(usdRadio).toHaveAttribute("aria-checked", "true");
  });

  it("gracefully falls back to 'Unavailable' in USD mode when price feed fails", async () => {
    mockPriceResponse = {
      ok: false,
      json: async () => ({ error: "Service down" }),
    };

    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("1.00 XLM")).toBeInTheDocument();
    });

    const usdRadio = screen.getByRole("radio", { name: /display in usd/i });
    await user.click(usdRadio);

    await waitFor(() => {
      const unavailableBadges = screen.getAllByText("Unavailable");
      expect(unavailableBadges.length).toBe(2);
    });
  });

  it("persists currency preference in localStorage across sessions", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("1.00 XLM")).toBeInTheDocument();
    });

    const usdRadio = screen.getByRole("radio", { name: /display in usd/i });
    await user.click(usdRadio);

    expect(window.localStorage.getItem("payments.currencyDisplay")).toBe(
      JSON.stringify("USD")
    );
  });

  it("restores stored USD preference on initial render", async () => {
    window.localStorage.setItem(
      "payments.currencyDisplay",
      JSON.stringify("USD")
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("$0.12")).toBeInTheDocument();
      expect(screen.getByText("$6.00")).toBeInTheDocument();
    });

    const usdRadio = screen.getByRole("radio", { name: /display in usd/i });
    expect(usdRadio).toHaveAttribute("aria-checked", "true");
  });
});
