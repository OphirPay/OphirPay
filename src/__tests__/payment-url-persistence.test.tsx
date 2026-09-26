// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import {
  parsePaymentQueryParams,
  buildShareablePaymentUrl,
  buildShareablePaymentQuery,
} from "@/lib/payment-filters";
import { encodeCursor } from "@/lib/pagination-utils";
import type { OnChainPayment } from "@/lib/contracts";

const replaceMock = vi.fn();
const fetchOnChainPaymentsMock = vi.fn();

let currentSearchParams: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/payments",
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: (...args: unknown[]) => fetchOnChainPaymentsMock(...args),
}));

const mockPayments: OnChainPayment[] = [
  {
    id: 1,
    payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    amountStroops: 30000000,
    txHash: "a".repeat(64),
    timestamp: 3000,
    metadata: "RECORDED",
    assetCode: "XLM",
  },
  {
    id: 2,
    payer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    payee: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    amountStroops: 10000000,
    txHash: "b".repeat(64),
    timestamp: 1000,
    metadata: "CANCELLED",
    assetCode: "USDC",
  },
];

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({
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

describe("Payment URL Persistence & Validation Helpers (Issue #792)", () => {
  it("parses valid query parameters correctly", () => {
    const params = new URLSearchParams(
      "search=invoice&status=RECORDED&asset=XLM&dateFrom=2026-01-01&dateTo=2026-01-31&sort=amount&dir=desc&page=2&pageSize=50"
    );
    const parsed = parsePaymentQueryParams(params);

    expect(parsed.search).toBe("invoice");
    expect(parsed.status).toBe("RECORDED");
    expect(parsed.asset).toBe("XLM");
    expect(parsed.dateFrom).toBe("2026-01-01");
    expect(parsed.dateTo).toBe("2026-01-31");
    expect(parsed.sort).toEqual({ key: "amount", dir: "desc" });
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(50);
    expect(parsed.invalidParams).toEqual([]);
  });

  it("supports legacy ?q= as fallback for ?search=", () => {
    const params = new URLSearchParams("q=legacy_search_term");
    const parsed = parsePaymentQueryParams(params);
    expect(parsed.search).toBe("legacy_search_term");
  });

  it("falls back to defaults and flags invalid parameters", () => {
    const params = new URLSearchParams(
      "status=INVALID_STATUS&page=-5&pageSize=999&sort=fake_col&dir=sideways&dateFrom=bad-date&cursor=corrupt-token"
    );
    const parsed = parsePaymentQueryParams(params);

    expect(parsed.status).toBe("");
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.sort).toEqual({ key: null, dir: "asc" });
    expect(parsed.dateFrom).toBe("");
    expect(parsed.cursor).toBeUndefined();

    expect(parsed.invalidParams).toContain("status");
    expect(parsed.invalidParams).toContain("page");
    expect(parsed.invalidParams).toContain("pageSize");
    expect(parsed.invalidParams).toContain("sort");
    expect(parsed.invalidParams).toContain("dir");
    expect(parsed.invalidParams).toContain("dateFrom");
    expect(parsed.invalidParams).toContain("cursor");
  });

  it("accepts a well-formed cursor without flagging as invalid", () => {
    const validCursor = encodeCursor({
      createdAt: new Date().toISOString(),
      id: "pay-123",
    });
    const params = new URLSearchParams(`cursor=${validCursor}`);
    const parsed = parsePaymentQueryParams(params);

    expect(parsed.cursor).toBe(validCursor);
    expect(parsed.invalidParams).toEqual([]);
  });

  it("builds clean shareable links by intentionally omitting cursor and page", () => {
    const shareQuery = buildShareablePaymentQuery({
      search: "acme",
      status: "RECORDED",
      asset: "XLM",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      sort: { key: "date", dir: "desc" },
    });

    expect(shareQuery.get("search")).toBe("acme");
    expect(shareQuery.get("status")).toBe("RECORDED");
    expect(shareQuery.get("asset")).toBe("XLM");
    expect(shareQuery.get("dateFrom")).toBe("2026-01-01");
    expect(shareQuery.get("dateTo")).toBe("2026-01-31");
    expect(shareQuery.get("sort")).toBe("date");
    expect(shareQuery.get("dir")).toBe("desc");

    // Must NOT contain cursor or page
    expect(shareQuery.get("page")).toBeNull();
    expect(shareQuery.get("cursor")).toBeNull();

    const url = buildShareablePaymentUrl("/payments", {
      search: "acme",
      status: "RECORDED",
    });
    expect(url).toBe("/payments?search=acme&status=RECORDED");
  });
});

describe("PaymentsPage URL Integration & User Experience (Issue #792)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    fetchOnChainPaymentsMock.mockResolvedValue({
      payments: mockPayments,
      total: mockPayments.length,
    });
  });

  it("hydrates search, status, and sort controls from URL parameters", async () => {
    currentSearchParams = new URLSearchParams("search=GBBB&status=RECORDED");
    renderPage();

    await waitFor(() => {
      const searchInput = screen.getByLabelText("Search payments") as HTMLInputElement;
      expect(searchInput.value).toBe("GBBB");
    });

    const statusSelect = screen.getByLabelText("Filter by status") as HTMLSelectElement;
    expect(statusSelect.value).toBe("RECORDED");

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeDefined();
      expect(screen.queryByText("#2")).toBeNull();
    });
  });

  it("displays an accessible notice banner when invalid parameters are detected in URL", async () => {
    currentSearchParams = new URLSearchParams("page=-10&sort=unknown_column");
    renderPage();

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain("Invalid filter parameter");
      expect(alert.textContent).toContain("page");
      expect(alert.textContent).toContain("sort");
    });

    // Clicking 'Clean URL' clears invalid params
    const cleanButton = screen.getByText("Clean URL");
    fireEvent.click(cleanButton);

    expect(replaceMock).toHaveBeenCalled();
  });

  it("updates URL without full navigation when changing status filter and resets page", async () => {
    currentSearchParams = new URLSearchParams("page=2");
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Filter by status")).toBeDefined();
    });

    const statusSelect = screen.getByLabelText("Filter by status");
    fireEvent.change(statusSelect, { target: { value: "CANCELLED" } });

    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("status=CANCELLED"),
      { scroll: false }
    );
    // Page must be reset
    expect(replaceMock).toHaveBeenCalledWith(
      expect.not.stringContaining("page=2"),
      { scroll: false }
    );
  });

  it("clears all active filters when clicking Reset Filters", async () => {
    currentSearchParams = new URLSearchParams("search=test&status=RECORDED&asset=XLM");
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Reset all filters")).toBeDefined();
    });

    const resetButton = screen.getByLabelText("Reset all filters");
    fireEvent.click(resetButton);

    expect(replaceMock).toHaveBeenCalledWith("/payments", { scroll: false });
  });

  it("provides a Share button to copy the shareable URL", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    currentSearchParams = new URLSearchParams("search=GAAA&status=RECORDED");
    renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Share filtered view")).toBeDefined();
    });

    const shareBtn = screen.getByLabelText("Share filtered view");
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalled();
      const copiedUrl = writeTextMock.mock.calls[0][0];
      expect(copiedUrl).toContain("search=GAAA");
      expect(copiedUrl).toContain("status=RECORDED");
    });
  });
});
