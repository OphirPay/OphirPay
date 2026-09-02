// SPDX-License-Identifier: MIT
// Proves that a malicious payment memo (e.g. `<script>` / event-handler HTML)
// is rendered as escaped text by the payment detail view — never executed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentDetailView from "@/app/payments/[id]/PaymentDetailView";
import type { Payment } from "@/types";

const fetchMock = vi.fn();
let resolveFetch: ((value: unknown) => void) | null = null;

const VALID_ID = "cm1234567890123456789012";

const MALICIOUS_MEMO =
  '<script>window.__pwned=1</script><img src=x onerror="window.__pwned=2">';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentDetailView id={VALID_ID} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  resolveFetch = null;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);
});

describe("PaymentDetailView memo XSS safety", () => {
  it("renders a malicious memo as escaped text and never executes it", async () => {
    const payment: Payment = {
      id: VALID_ID,
      amount: 250,
      status: "COMPLETED",
      assetCode: "XLM",
      memo: MALICIOUS_MEMO,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-02T12:00:00.000Z",
    };

    const { container } = renderPage();

    await act(async () => {
      resolveFetch?.(jsonResponse(200, { success: true, data: payment }));
    });

    // The raw memo text is present verbatim (React escapes it to text nodes).
    expect(await screen.findByText(MALICIOUS_MEMO)).toBeInTheDocument();

    // No <script> element was created in the DOM.
    expect(container.querySelector("script")).toBeNull();
    // No <img> with an onerror handler was created.
    expect(container.querySelector("img")).toBeNull();
    // window was never touched by the injected payload.
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
