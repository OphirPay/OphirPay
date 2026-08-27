// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";

const mocks = vi.hoisted(() => ({
  fetchOnChainPayments: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: mocks.fetchOnChainPayments,
}));

const payment = {
  id: 1,
  payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  amountStroops: 10000000,
  txHash:
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  timestamp: 1700000000,
};

type OnChainResult = { payments: typeof payment[]; total: number };

let resolveFetch: (value: OnChainResult) => void;

beforeEach(() => {
  mocks.fetchOnChainPayments.mockReset();
  mocks.fetchOnChainPayments.mockImplementation(
    () =>
      new Promise<OnChainResult>((resolve) => {
        resolveFetch = resolve;
      })
  );
});

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

describe("PaymentsPage loading skeleton", () => {
  it("renders a skeleton while the on-chain read is pending, then content after it resolves", async () => {
    const { container } = renderPage();

    // While the query is pending: pulsing skeleton rows are visible and no
    // payment data has rendered yet.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("#1")).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch({ payments: [payment], total: 1 });
    });

    // Skeleton disappears cleanly and the payment row renders in its place.
    await waitFor(() => {
      expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
    });
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("1 on-chain record")).toBeInTheDocument();
  });
});
