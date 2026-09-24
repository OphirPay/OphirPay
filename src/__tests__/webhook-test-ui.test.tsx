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

const BLOCKED_WEBHOOK = {
  id: "wh-test",
  url: "http://127.0.0.1:8080/hook",
  events: JSON.stringify(["payment.completed"]),
  isActive: true,
  hasSecret: true,
  createdAt: new Date().toISOString(),
};

const TEST_RESULT = {
  delivered: true,
  status: "delivered",
  statusCode: 200,
  event: "payment.completed",
  test: true,
  durationMs: 12,
  latencyMs: 12,
  responseBody: '{"received":true,"status":"ok"}',
  deliveryId: "del-789",
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

describe("WebhookDetailPage (Send test event & Delivery preview)", () => {
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

  it("renders delivery preview tabs and byte-for-byte preview", async () => {
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

    expect(await screen.findByText("Delivery Preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wire body/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /canonical payload/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /http headers/i })).toBeInTheDocument();

    const user = userEvent.setup();
    // Switch to canonical payload tab
    await user.click(screen.getByRole("button", { name: /canonical payload/i }));
    expect(await screen.findByText(/emptied signature/i)).toBeInTheDocument();

    // Switch to HTTP headers tab
    await user.click(screen.getByRole("button", { name: /http headers/i }));
    expect(await screen.findByText("X-OphirPay-Signature")).toBeInTheDocument();
  });

  it("displays URL guard warning and disables the send button when the target URL is blocked", async () => {
    setupFetch((url) => {
      if (url.includes("/api/csrf")) {
        return new Response(JSON.stringify({ token: "t".repeat(64) }), { status: 200 });
      }
      if (url.includes("/api/webhooks") && !url.includes("/test")) {
        return new Response(JSON.stringify({ data: [BLOCKED_WEBHOOK] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    renderPage();

    const warning = await screen.findByTestId("url-guard-warning");
    expect(warning).toBeInTheDocument();
    expect(within(warning).getByText("Target URL Rejected by SSRF Guard")).toBeInTheDocument();
    expect(within(warning).getByText(/private\/internal IPv4 address range/i)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /send test event/i });
    expect(button).toBeDisabled();
  });

  it("fires a test event and displays the delivery result with response body and delivery record link", async () => {
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

    // Response body excerpt displayed
    const responseBody = await screen.findByTestId("response-body");
    expect(responseBody).toHaveTextContent('{"received":true,"status":"ok"}');

    // Link to delivery record
    const deliveryLink = screen.getByTestId("delivery-record-link");
    expect(deliveryLink).toHaveAttribute("href", expect.stringContaining("del-789"));

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
            data: { ...TEST_RESULT, delivered: false, status: "failed", statusCode: 500, responseBody: "Internal Server Error" },
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
    expect(await screen.findByTestId("response-body")).toHaveTextContent("Internal Server Error");
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
