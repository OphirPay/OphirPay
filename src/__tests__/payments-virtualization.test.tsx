// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import { useVirtualRows } from "@/hooks/useVirtualRows";
import type { OnChainPayment } from "@/lib/contracts";

const pushMock = vi.fn();
let searchParams: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock, prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => searchParams,
}));

const { PAYMENTS } = vi.hoisted(() => {
  const payments = Array.from({ length: 600 }, (_, i) => ({
    id: i + 1,
    payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    amountStroops: (i + 1) * 10_000_000,
    txHash: "abcdef0123456789".repeat(4),
    timestamp: 1_700_000_000 + i,
  })) as OnChainPayment[];
  return { PAYMENTS: payments };
});

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
    payments: PAYMENTS,
    total: PAYMENTS.length,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <PaymentsPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  pushMock.mockClear();
  searchParams = new URLSearchParams("");
});

describe("useVirtualRows", () => {
  it("windows large row counts", () => {
    const { result } = renderHook(() => useVirtualRows(1000));
    expect(result.current.virtualized).toBe(true);
    expect(result.current.endIndex - result.current.startIndex).toBeLessThan(100);
  });

  it("renders every row below the threshold", () => {
    const { result } = renderHook(() => useVirtualRows(20));
    expect(result.current.virtualized).toBe(false);
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(20);
  });
});

describe("PaymentsPage virtualization", () => {
  it("mounts a bounded number of rows for a large page", async () => {
    searchParams = new URLSearchParams("pageSize=250");
    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelector("table")).toHaveAttribute(
        "aria-rowcount",
        String(PAYMENTS.length + 1)
      );
    });

    const rows = container.querySelectorAll("tr[data-row-index]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100); // far fewer than the 250 loaded

    // Screen readers still get the absolute position: header is row 1.
    expect(rows[0]).toHaveAttribute("aria-rowindex", "2");
  });

  it("renders every row for a small page", async () => {
    const { container } = renderPage();
    await screen.findByText("#1");
    const rows = container.querySelectorAll("tr[data-row-index]");
    expect(rows.length).toBe(25); // default page size, below the threshold
  });

  it("exposes a load-more affordance that grows the page size", async () => {
    renderPage();
    const loadMore = await screen.findByRole("button", { name: /load more/i });
    loadMore.click();

    // The page owns its filter/sort/page state in the URL, so growing the page
    // size goes through the same `updateQuery` push the pagination controls use.
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("pageSize=50"),
      { scroll: false }
    );
  });
});
