// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditLogPage from "@/app/audit-log/page";

const mockEntries = [
  {
    id: 1,
    timestamp: 1785542400, // 2026-08-01T00:00:00.000Z
    action: "payment_recorded",
    actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    target_id: 101,
    details: "Payment 101 recorded for 100 XLM",
  },
  {
    id: 2,
    timestamp: 1785628800, // 2026-08-02T00:00:00.000Z
    action: "escrow_created",
    actor: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    target_id: 102,
    details: "Escrow 102 created for 500 XLM",
  },
  {
    id: 3,
    timestamp: 1785715200, // 2026-08-03T00:00:00.000Z
    action: "contract_paused",
    actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    target_id: 0,
    details: "Contract paused by emergency multisig",
  },
  {
    id: 4,
    timestamp: 1785801600, // 2026-08-04T00:00:00.000Z
    action: "payment_recorded",
    actor: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    target_id: 104,
    details: "Payment 104 recorded for 25 XLM",
  },
  {
    id: 5,
    timestamp: 1785888000, // 2026-08-05T00:00:00.000Z
    action: "stream_created",
    actor: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    target_id: 105,
    details: "Stream 105 created with 10 XLM/day rate",
  },
  {
    id: 6,
    timestamp: 1785974400,
    action: "role_granted",
    actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    target_id: 106,
    details: "Role admin granted to operator",
  },
  {
    id: 7,
    timestamp: 1786060800,
    action: "batch_created",
    actor: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    target_id: 107,
    details: "Batch 107 created with 15 payments",
  },
  {
    id: 8,
    timestamp: 1786147200,
    action: "upgrade_executed",
    actor: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    target_id: 108,
    details: "Contract upgraded to v1.2",
  },
];

const { mockUseSearchParams, mockReplace } = vi.hoisted(() => ({
  mockUseSearchParams: vi.fn(() => new URLSearchParams("")),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/audit-log",
  useSearchParams: mockUseSearchParams,
}));

vi.mock("@/hooks/usePageTitle", () => ({
  usePageTitle: vi.fn(),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (_key: string[], _url?: string) => {
    return {
      data: mockEntries,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@/components/ui/CopyButton", () => ({
  CopyButton: ({ value }: { value: string }) => (
    <button data-testid={`copy-btn-${value}`}>Copy</button>
  ),
}));

interface MockSSEEvent {
  data?: string;
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, ((e: MockSSEEvent) => void)[]> = {};
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, cb: (e: MockSSEEvent) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }

  removeEventListener(event: string, cb: (e: MockSSEEvent) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== cb);
    }
  }

  emit(event: string, data: MockSSEEvent) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => cb(data));
    }
  }

  close() {
    this.listeners = {};
  }
}

global.EventSource = MockEventSource as unknown as typeof EventSource;

function renderAuditLog(searchParams = "") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mockUseSearchParams.mockReturnValue(new URLSearchParams(searchParams));

  return render(
    <QueryClientProvider client={queryClient}>
      <AuditLogPage />
    </QueryClientProvider>
  );
}

describe("AuditLogPage Component & Filtering", { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders audit log entries with headers and controls", () => {
    renderAuditLog();

    expect(screen.getByRole("heading", { name: /Audit Log/i })).toBeInTheDocument();
    expect(screen.getByTestId("total-count-badge")).toHaveTextContent("8 total on-chain entries");
    expect(screen.getByText("Payment 101 recorded for 100 XLM")).toBeInTheDocument();
    expect(screen.getByText("Escrow 102 created for 500 XLM")).toBeInTheDocument();
    expect(screen.getByText("Contract paused by emergency multisig")).toBeInTheDocument();
  });

  it("filters entries by actor when prefilled in URL search params", () => {
    renderAuditLog("actor=GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

    expect(screen.getByTestId("filter-actor")).toHaveValue(
      "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
    );
    expect(screen.getByText("Payment 101 recorded for 100 XLM")).toBeInTheDocument();
    expect(screen.getByText("Contract paused by emergency multisig")).toBeInTheDocument();
    expect(screen.queryByText("Escrow 102 created for 500 XLM")).not.toBeInTheDocument();
    expect(screen.getByTestId("filtered-count-badge")).toHaveTextContent("filtered: 4 of 8");
  });

  it("filters entries by action type when prefilled in URL search params", () => {
    renderAuditLog("action=payment_recorded");

    expect(screen.getByTestId("filter-action")).toHaveValue("payment_recorded");
    expect(screen.getByText("Payment 101 recorded for 100 XLM")).toBeInTheDocument();
    expect(screen.getByText("Payment 104 recorded for 25 XLM")).toBeInTheDocument();
    expect(screen.queryByText("Escrow 102 created for 500 XLM")).not.toBeInTheDocument();
    expect(screen.queryByText("Contract paused by emergency multisig")).not.toBeInTheDocument();
  });

  it("filters entries by date range (dateFrom and dateTo)", () => {
    // 2026-08-02 to 2026-08-04 covers ids 2, 3, 4
    renderAuditLog("dateFrom=2026-08-02&dateTo=2026-08-04");

    expect(screen.getByTestId("filter-date-from")).toHaveValue("2026-08-02");
    expect(screen.getByTestId("filter-date-to")).toHaveValue("2026-08-04");
    expect(screen.queryByText("Payment 101 recorded for 100 XLM")).not.toBeInTheDocument(); // Aug 1
    expect(screen.getByText("Escrow 102 created for 500 XLM")).toBeInTheDocument(); // Aug 2
    expect(screen.getByText("Contract paused by emergency multisig")).toBeInTheDocument(); // Aug 3
    expect(screen.getByText("Payment 104 recorded for 25 XLM")).toBeInTheDocument(); // Aug 4
    expect(screen.queryByText("Stream 105 created with 10 XLM/day rate")).not.toBeInTheDocument(); // Aug 5
  });

  it("composes multiple filters together (actor + action + date)", () => {
    renderAuditLog("actor=GCCC&action=escrow_created&dateFrom=2026-08-01");

    expect(screen.getByText("Escrow 102 created for 500 XLM")).toBeInTheDocument();
    expect(screen.queryByText("Stream 105 created with 10 XLM/day rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Payment 101 recorded for 100 XLM")).not.toBeInTheDocument();
  });

  it("updates URL search params when user types in actor filter", () => {
    renderAuditLog();

    const actorInput = screen.getByTestId("filter-actor");
    fireEvent.change(actorInput, { target: { value: "GBBB" } });

    expect(mockReplace).toHaveBeenCalledWith("/audit-log?actor=GBBB", {
      scroll: false,
    });
  });

  it("updates URL search params when user changes action dropdown", () => {
    renderAuditLog();

    const actionSelect = screen.getByTestId("filter-action");
    fireEvent.change(actionSelect, { target: { value: "stream_created" } });

    expect(mockReplace).toHaveBeenCalledWith("/audit-log?action=stream_created", {
      scroll: false,
    });
  });

  it("updates URL search params when user changes date filters", () => {
    renderAuditLog();

    const dateFrom = screen.getByTestId("filter-date-from");
    fireEvent.change(dateFrom, { target: { value: "2026-08-01" } });

    expect(mockReplace).toHaveBeenCalledWith("/audit-log?dateFrom=2026-08-01", {
      scroll: false,
    });
  });

  it("clears all filters when clear button is clicked", () => {
    renderAuditLog("actor=GBBB&action=payment_recorded&dateFrom=2026-08-01");

    const clearBtn = screen.getByTestId("filter-clear");
    expect(clearBtn).toBeInTheDocument();

    fireEvent.click(clearBtn);

    expect(mockReplace).toHaveBeenCalledWith("/audit-log", {
      scroll: false,
    });
  });

  it("shows empty state when no entries match filters and allows clearing", () => {
    renderAuditLog("actor=NON_EXISTENT_ACTOR");

    expect(screen.getByText("No Matching Entries")).toBeInTheDocument();
    expect(screen.getByText(/No entries match your selected filter criteria/i)).toBeInTheDocument();

    const clearButton = screen.getByRole("button", { name: /clear all filters/i });
    fireEvent.click(clearButton);

    expect(mockReplace).toHaveBeenCalledWith("/audit-log", {
      scroll: false,
    });
  });

  it("composes pagination with filters", () => {
    // pageSize=5 with 8 entries total -> 2 pages
    renderAuditLog("pageSize=5&page=1");

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent("Showing 1–5 of 8 entries");

    // Go to next page
    const nextBtn = screen.getByRole("button", { name: /Next →/i });
    fireEvent.click(nextBtn);

    expect(mockReplace).toHaveBeenCalledWith("/audit-log?pageSize=5&page=2", {
      scroll: false,
    });
  });

  it("toggles live mode and receives streaming entries", async () => {
    renderAuditLog();

    const liveBtn = screen.getByTestId("live-toggle-btn");
    fireEvent.click(liveBtn);

    expect(MockEventSource.instances.length).toBe(1);
    const es = MockEventSource.instances[0];

    act(() => {
      es.emit("connected", { data: JSON.stringify({ message: "connected" }) });
    });

    await waitFor(() => {
      expect(screen.getByText(/Live ●/i)).toBeInTheDocument();
    });

    // Simulate receiving a new audit entry via SSE
    act(() => {
      es.emit("audit:entry", {
        data: JSON.stringify({
          id: 99,
          timestamp: 1786233600,
          action: "multisig_executed",
          actor: "GEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          target_id: 999,
          details: "Live streamed multisig execution",
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Live streamed multisig execution")).toBeInTheDocument();
      expect(screen.getByTestId("total-count-badge")).toHaveTextContent("9 total on-chain entries");
    });
  });
});
