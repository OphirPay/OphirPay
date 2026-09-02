// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditLogPage from "@/app/audit-log/page";

let mockSearchParams: URLSearchParams;
const mockRouter = { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/audit-log",
  useSearchParams: () => mockSearchParams,
}));

const fetchMock = vi.fn();

interface AuditEntry {
  id: number;
  timestamp: number;
  action: string;
  actor: string;
  target_id: number;
  details: string;
}

function okJson(data: unknown, meta: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data,
      meta: { page: 1, limit: 20, total: 0, ...meta },
    }),
  };
}

function entry(id: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    timestamp: 1700000000 + id,
    action: "payment_recorded",
    actor: "GABCDEFGH12345678",
    target_id: id,
    details: `Payment #${id} recorded`,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditLogPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
  mockRouter.replace.mockClear();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("AuditLogPage filters", () => {
  it("loads entries with default pagination params", async () => {
    fetchMock.mockResolvedValue(okJson([entry(2), entry(1)], { total: 2 }));
    renderPage();

    expect(await screen.findByText("Payment #2 recorded")).toBeInTheDocument();
    expect(screen.getByText("Payment #1 recorded")).toBeInTheDocument();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/audit-log?");
    expect(url).toContain("page=1");
    expect(url).toContain("limit=20");
  });

  it("passes actor, action, and date range URL params to the API", async () => {
    mockSearchParams = new URLSearchParams(
      "?actor=GABC&action=payment_recorded&since=1700000000&until=1700100000"
    );
    fetchMock.mockResolvedValue(okJson([entry(1)], { total: 1 }));
    renderPage();

    expect(await screen.findByText("Payment #1 recorded")).toBeInTheDocument();

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("actor=GABC");
    expect(url).toContain("action=payment_recorded");
    expect(url).toContain("since=1700000000");
    expect(url).toContain("until=1700100000");
  });

  it("marks the result as filtered when URL filters are present", async () => {
    mockSearchParams = new URLSearchParams("?action=payment_cancelled");
    fetchMock.mockResolvedValue(okJson([entry(1)], { total: 1 }));
    renderPage();

    expect(await screen.findByText("Payment #1 recorded")).toBeInTheDocument();
    expect(screen.getByText(/\(filtered\)/)).toBeInTheDocument();
  });

  it("updates the URL when the action type is selected", async () => {
    fetchMock.mockResolvedValue(okJson([], { total: 0 }));
    renderPage();

    const select = await screen.findByLabelText("Action type");
    fireEvent.change(select, { target: { value: "payment_recorded" } });

    expect(mockRouter.replace).toHaveBeenCalledWith(
      "/audit-log?action=payment_recorded",
      { scroll: false }
    );
  });

  it("updates the URL (debounced) when the actor is typed", async () => {
    fetchMock.mockResolvedValue(okJson([], { total: 0 }));
    renderPage();

    const input = await screen.findByLabelText("Actor");
    fireEvent.change(input, { target: { value: "GABC" } });

    await waitFor(
      () =>
        expect(mockRouter.replace).toHaveBeenCalledWith(
          "/audit-log?actor=GABC",
          { scroll: false }
        ),
      { timeout: 2000 }
    );
  });

  it("updates the URL with unix timestamps when a date range is picked", async () => {
    fetchMock.mockResolvedValue(okJson([], { total: 0 }));
    renderPage();

    const from = await screen.findByLabelText("From");
    fireEvent.change(from, { target: { value: "2026-08-01" } });

    const expected = String(
      Math.floor(new Date("2026-08-01T00:00:00").getTime() / 1000)
    );
    expect(mockRouter.replace).toHaveBeenCalledWith(
      `/audit-log?since=${expected}`,
      { scroll: false }
    );
  });

  it("shows the empty state with a filter-aware message", async () => {
    mockSearchParams = new URLSearchParams("?action=payment_cancelled");
    fetchMock.mockResolvedValue(okJson([], { total: 0 }));
    renderPage();

    expect(await screen.findByText("No Matching Entries")).toBeInTheDocument();
  });

  it("shows the empty state when the ledger is empty", async () => {
    fetchMock.mockResolvedValue(okJson([], { total: 0 }));
    renderPage();

    expect(await screen.findByText("No Audit Entries")).toBeInTheDocument();
  });
});

describe("AuditLogPage pagination", () => {
  it("composes pagination with filters in the URL and the API call", async () => {
    mockSearchParams = new URLSearchParams("?actor=GABC");
    fetchMock.mockResolvedValue(okJson([entry(1)], { total: 50 }));
    const { rerender } = renderPage();

    // 50 entries at 20/page → 3 pages, Next is enabled
    expect(await screen.findByText("Payment #1 recorded")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: /next/i });
    expect(next).toBeEnabled();

    // Navigating to page 2 keeps the actor filter in the URL
    fireEvent.click(next);
    expect(mockRouter.replace).toHaveBeenCalledWith(
      "/audit-log?actor=GABC&page=2",
      { scroll: false }
    );

    // Simulate the URL change being applied, then verify the refetch
    // sends both the filter and the new page to the API.
    mockSearchParams = new URLSearchParams("?actor=GABC&page=2");
    fetchMock.mockResolvedValue(okJson([entry(2)], { total: 50 }));
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <AuditLogPage />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const lastUrl = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
      expect(lastUrl).toContain("actor=GABC");
      expect(lastUrl).toContain("page=2");
    });

    // The refetched page renders with the filter still applied
    expect(await screen.findByText("Payment #2 recorded")).toBeInTheDocument();
    expect(screen.getByText(/of 50 entries/)).toBeInTheDocument();
  });
});
