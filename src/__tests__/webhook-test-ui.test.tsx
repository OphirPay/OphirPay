// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import WebhookDetailPage from "@/app/webhooks/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "wh-test" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/webhooks/wh-test",
}));

const WEBHOOK = {
  id: "wh-test",
  url: "https://example.com/hook",
  events: JSON.stringify(["payment.completed"]),
  isActive: true,
  hasSecret: true,
  createdAt: new Date().toISOString(),
};

const TEST_RESULT = {
  delivered: true,
  status: "delivered",
  event: "payment.completed",
  test: true,
  durationMs: 12,
  sentAt: new Date().toISOString(),
};

function setupFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WebhookDetailPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("WebhookDetailPage (Send test event)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the webhook configuration and a Send test event button", async () => {
    setupFetch((url) => {
      if (url.includes("/api/csrf")) {
        return new Response(JSON.stringify({ token: "t".repeat(64) }), { status: 200 });
      }
      if (url.includes("/api/webhooks") && !url.includes("/test")) {
        return new Response(JSON.stringify({ data: [WEBHOOK] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderPage();

    expect(await screen.findByText("Send Test Event")).toBeInTheDocument();
    expect(await screen.findByText("https://example.com/hook")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send test event/i })).toBeInTheDocument();
  });

  it("fires a test event and displays the delivery result", async () => {
    const fetchMock = setupFetch((url, init) => {
      if (url.includes("/api/csrf")) {
        return new Response(JSON.stringify({ token: "t".repeat(64) }), { status: 200 });
      }
      if (url.includes("/api/webhooks") && !(init?.method === "POST")) {
        return new Response(JSON.stringify({ data: [WEBHOOK] }), { status: 200 });
      }
      if (url.includes("/api/webhooks/wh-test/test")) {
        return new Response(JSON.stringify({ data: TEST_RESULT }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole("button", { name: /send test event/i });
    await user.click(button);

    const resultCard = await screen.findByTestId("test-result", {}, { timeout: 3000 });
    expect(within(resultCard).getByText("Delivered")).toBeInTheDocument();
    expect(within(resultCard).getByText("payment.completed")).toBeInTheDocument();
    expect(within(resultCard).getByText("test: true")).toBeInTheDocument();

    // The test endpoint was actually called with a POST.
    const testCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/test"));
    expect(testCall).toBeDefined();
    expect((testCall![1] as RequestInit).method).toBe("POST");
  });

  it("shows a failure result when the endpoint rejects the event", async () => {
    setupFetch((url, init) => {
      if (url.includes("/api/csrf")) {
        return new Response(JSON.stringify({ token: "t".repeat(64) }), { status: 200 });
      }
      if (url.includes("/api/webhooks") && !(init?.method === "POST")) {
        return new Response(JSON.stringify({ data: [WEBHOOK] }), { status: 200 });
      }
      if (url.includes("/api/webhooks/wh-test/test")) {
        return new Response(
          JSON.stringify({
            data: { ...TEST_RESULT, delivered: false, status: "failed" },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    });

    const user = userEvent.setup();
    renderPage();

    const button = await screen.findByRole("button", { name: /send test event/i });
    await user.click(button);

    const resultCard = await screen.findByTestId("test-result", {}, { timeout: 3000 });
    expect(within(resultCard).getByText("Failed")).toBeInTheDocument();
  });

  it("shows a not-found state when the webhook is absent", async () => {
    setupFetch((url) => {
      if (url.includes("/api/csrf")) {
        return new Response(JSON.stringify({ token: "t".repeat(64) }), { status: 200 });
      }
      if (url.includes("/api/webhooks")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderPage();

    expect(await screen.findByText(/webhook not found/i)).toBeInTheDocument();
  });
});
