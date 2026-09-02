// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WebhooksPage from "@/app/webhooks/page";
import { ToastProvider } from "@/components/ui/Toast";

const fetchMock = vi.fn();

interface Webhook {
  id: string;
  url: string;
  events: string;
  isActive: boolean;
  hasSecret: boolean;
  createdAt: string;
}

const webhooks: Webhook[] = [
  {
    id: "wh-1",
    url: "https://hook.example.com/a",
    events: '["payment_recorded"]',
    isActive: true,
    hasSecret: true,
    createdAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "wh-2",
    url: "https://hook.example.com/b",
    events: '["escrow_created"]',
    isActive: true,
    hasSecret: true,
    createdAt: "2026-08-02T00:00:00Z",
  },
];

const jsonResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});

function mockApi() {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/csrf")) {
      return Promise.resolve(jsonResponse({ token: "csrf-token" }));
    }
    if (url.includes("/api/webhooks?id=")) {
      return Promise.resolve(
        jsonResponse({
          success: true,
          data: { id: "wh-1", secret: "new-secret-abc123" },
        })
      );
    }
    if (url.includes("/api/webhooks")) {
      return Promise.resolve(jsonResponse({ success: true, data: webhooks }));
    }
    return Promise.resolve(jsonResponse({ success: true, data: null }));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WebhooksPage />
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  mockApi();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("WebhooksPage secret rotation", () => {
  it("renders a Rotate Secret action for every webhook", async () => {
    renderPage();

    expect(await screen.findByText("https://hook.example.com/a")).toBeInTheDocument();
    expect(screen.getByText("https://hook.example.com/b")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /rotate secret/i })).toHaveLength(2);
  });

  it("warns about integrator impact before rotating", async () => {
    renderPage();
    const rotateButtons = await screen.findAllByRole("button", {
      name: /rotate secret/i,
    });

    fireEvent.click(rotateButtons[0]);

    expect(screen.getByText(/integrator impact/i)).toBeInTheDocument();
    expect(screen.getByText(/old secret/i)).toBeInTheDocument();
    expect(
      screen.getByText(/stop receiving valid webhooks/i)
    ).toBeInTheDocument();
  });

  it("confirms rotation, calls the API with the webhook id, and shows the new secret once", async () => {
    renderPage();
    const rotateButtons = await screen.findAllByRole("button", {
      name: /rotate secret/i,
    });

    fireEvent.click(rotateButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: /confirm rotation/i }));

    // PATCH /api/webhooks?id=wh-1
    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).includes("/api/webhooks?id=wh-1") &&
          (c[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patchCalls).toHaveLength(1);
    });

    // New secret shown exactly once, with a copy button and a save-now warning
    expect(await screen.findByText("new-secret-abc123")).toBeInTheDocument();
    expect(
      screen.getAllByText(/won't be shown again/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/previous secret was revoked immediately/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy secret/i })).toBeInTheDocument();
    expect(
      screen.getAllByText("https://hook.example.com/a").length
    ).toBeGreaterThan(0);
  });

  it("cancelling the rotation does not call the API", async () => {
    renderPage();
    const rotateButtons = await screen.findAllByRole("button", {
      name: /rotate secret/i,
    });

    fireEvent.click(rotateButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByText(/integrator impact/i)).toBeNull();
    const patchCalls = fetchMock.mock.calls.filter(
      (c) =>
        String(c[0]).includes("/api/webhooks?id=") &&
        (c[1] as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCalls).toHaveLength(0);
  });
});
