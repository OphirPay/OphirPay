// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EmptyState } from "@/components/EmptyState";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import BatchesPage from "@/app/batches/page";
import WebhooksPage from "@/app/webhooks/page";
import EventsPage from "@/app/events/page";
import AuditLogPage from "@/app/audit-log/page";

// ═══════════════════════════════════════════════════════════════
// Mocks shared by the page-level tests
// ═══════════════════════════════════════════════════════════════

const { useApiQueryMock, useApiMutationMock, routerPushMock } = vi.hoisted(() => ({
  useApiQueryMock: vi.fn(),
  useApiMutationMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: useApiQueryMock,
  useApiMutation: useApiMutationMock,
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn(),
}));

// Minimal EventSource stub — jsdom does not implement EventSource.
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, (event: { data?: string }) => void> = {};
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: { data?: string }) => void) {
    this.listeners[type] = cb;
  }

  removeEventListener() {}

  close() {
    this.onerror = null;
  }
}

vi.stubGlobal("EventSource", MockEventSource);

function mockQuery(overrides: Record<string, unknown> = {}) {
  useApiQueryMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════
// EmptyState component
// ═══════════════════════════════════════════════════════════════

describe("EmptyState", () => {
  it("renders the icon, title, and description", () => {
    render(
      <EmptyState
        icon={<span data-testid="empty-icon">🔔</span>}
        title="Nothing Here"
        description="There is nothing to show yet."
      />
    );

    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /nothing here/i })).toBeInTheDocument();
    expect(screen.getByText("There is nothing to show yet.")).toBeInTheDocument();
  });

  it("renders a primary action button that calls onAction when clicked", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={<span>📭</span>}
        title="Empty"
        description="Get started below."
        actionLabel="Create First Payment"
        onAction={onAction}
      />
    );

    const button = screen.getByRole("button", { name: /create first payment/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("omits the action button when no onAction is provided", () => {
    render(
      <EmptyState
        icon={<span>📭</span>}
        title="Empty"
        description="Nothing to act on."
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a custom action icon when provided", () => {
    render(
      <EmptyState
        icon={<span>📭</span>}
        title="Empty"
        description="Get started below."
        actionLabel="Enable Live"
        actionIcon={<span data-testid="custom-action-icon">▶</span>}
        onAction={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: /enable live/i });
    expect(button).toContainElement(screen.getByTestId("custom-action-icon"));
  });
});

// ═══════════════════════════════════════════════════════════════
// Payments page
// ═══════════════════════════════════════════════════════════════

describe("PaymentsPage empty state", () => {
  beforeEach(() => {
    routerPushMock.mockClear();
  });

  it("renders a designed empty state with a create action when there are no payments", () => {
    mockQuery({ data: { payments: [], total: 0 } });
    render(<PaymentsPage />);

    expect(screen.getByRole("heading", { name: /no payments yet/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create first payment/i })
    ).toBeInTheDocument();
  });

  it("navigates to the send page when the empty-state action is clicked", () => {
    mockQuery({ data: { payments: [], total: 0 } });
    render(<PaymentsPage />);

    fireEvent.click(screen.getByRole("button", { name: /create first payment/i }));
    expect(routerPushMock).toHaveBeenCalledWith("/send");
  });

  it("does not render the empty state when payments exist", () => {
    mockQuery({
      data: {
        payments: [
          {
            id: 1,
            payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            amountStroops: 10000000,
            txHash:
              "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            timestamp: 1700000000,
          },
        ],
        total: 1,
      },
    });
    render(<PaymentsPage />);

    expect(screen.queryByRole("heading", { name: /no payments yet/i })).toBeNull();
    expect(screen.getByText("#1")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════
// Batches page
// ═══════════════════════════════════════════════════════════════

describe("BatchesPage empty state", () => {
  it("renders a designed empty state with a create action when there are no batches", () => {
    mockQuery({ data: [] });
    // BatchesPage calls useQueryClient() directly (live-event cache
    // invalidation) and useToast(), so it needs providers around the
    // mocked query hooks.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BatchesPage />
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(
      screen.getByRole("heading", { name: /no batch payments yet/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create batch/i })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════
// Webhooks page
// ═══════════════════════════════════════════════════════════════

describe("WebhooksPage empty state", () => {
  beforeEach(() => {
    useApiMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
  });

  it("renders a designed empty state with an add action when there are no webhooks", () => {
    mockQuery({ data: [] });
    render(
      <ToastProvider>
        <WebhooksPage />
      </ToastProvider>
    );

    expect(
      screen.getByRole("heading", { name: /no webhooks yet/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add webhook/i })).toBeInTheDocument();
  });

  it("opens the create-webhook modal from the empty-state action", () => {
    mockQuery({ data: [] });
    render(
      <ToastProvider>
        <WebhooksPage />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /add webhook/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /add webhook endpoint/i })
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════
// Events page
// ═══════════════════════════════════════════════════════════════

describe("EventsPage empty states", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    routerPushMock.mockClear();
    // jsdom does not implement scrollIntoView; EventFeed auto-scrolls.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders a designed empty state for the live feed", async () => {
    mockQuery({ data: { payments: [] } });
    render(<EventsPage />);

    // EventFeed is code-split via next/dynamic — wait for it to mount.
    expect(
      await screen.findByText(/listening for payment events/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/send a payment to see it appear here in real-time/i)
    ).toBeInTheDocument();
  });

  it("renders a designed empty state for on-chain records", async () => {
    mockQuery({ data: { payments: [] } });
    render(<EventsPage />);

    const onChainTab = await screen.findByRole("button", { name: /on-chain/i });
    fireEvent.click(onChainTab);

    expect(
      await screen.findByText(/no on-chain records yet/i)
    ).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════
// Audit log page
// ═══════════════════════════════════════════════════════════════

describe("AuditLogPage empty states", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
  });

  it("renders a designed empty state with an enable-live action when there are no entries", () => {
    mockQuery({ data: [] });
    render(<AuditLogPage />);

    expect(
      screen.getByRole("heading", { name: /no audit entries/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /enable live/i })
    ).toBeInTheDocument();
  });

  it("starts live streaming from the empty-state action", () => {
    mockQuery({ data: [] });
    render(<AuditLogPage />);

    fireEvent.click(screen.getByRole("button", { name: /enable live/i }));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/audit-log/sse");
    expect(
      screen.getByText(/listening for contract activity/i)
    ).toBeInTheDocument();
  });

  it("renders a clear-filter action when a filter matches nothing", () => {
    mockQuery({
      data: [
        {
          id: 1,
          timestamp: 1700000000,
          action: "payment_recorded",
          actor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          target_id: 1,
          details: "Payment 1 recorded",
        },
      ],
    });
    render(<AuditLogPage />);

    fireEvent.change(screen.getByPlaceholderText(/filter by action or details/i), {
      target: { value: "zzz-no-match" },
    });

    expect(
      screen.getByRole("heading", { name: /no matching entries/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear filter/i })
    ).toBeInTheDocument();
  });

  it("clears the filter from the empty-state action", () => {
    mockQuery({
      data: [
        {
          id: 1,
          timestamp: 1700000000,
          action: "payment_recorded",
          actor: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          target_id: 1,
          details: "Payment 1 recorded",
        },
      ],
    });
    render(<AuditLogPage />);

    fireEvent.change(screen.getByPlaceholderText(/filter by action or details/i), {
      target: { value: "zzz-no-match" },
    });
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));

    expect(screen.getByText("Payment 1 recorded")).toBeInTheDocument();
  });
});
