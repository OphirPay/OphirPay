// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentDetailView from "@/app/payments/[id]/PaymentDetailView";
import type { Payment } from "@/types";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    mocks.notFound();
    // The real notFound() throws to short-circuit rendering; replicate that
    // so the component aborts instead of falling through to the error state.
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// ── Test helpers ───────────────────────────────────────────────

/**
 * Captures render-phase errors (like the one thrown by notFound()) so the
 * test can assert them without crashing the render.
 */
class ErrorCapture extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

const fetchMock = vi.fn();
let resolveFetch: ((value: unknown) => void) | null = null;

const VALID_ID = "cm1234567890123456789012";

const payment: Payment = {
  id: VALID_ID,
  amount: 250,
  status: "COMPLETED",
  assetCode: "XLM",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-02T12:00:00.000Z",
  description: "Invoice #42",
  transactionHash:
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * Renders the view with an id prop. (The route wrapper — `page.tsx` — only
 * awaits the params promise and forwards the id, so it needs no test.)
 */
function renderPage(
  id: string,
  onError: (error: Error) => void = () => {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ErrorCapture onError={onError}>
        <PaymentDetailView id={id} />
      </ErrorCapture>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.notFound.mockClear();
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

// ── Tests ──────────────────────────────────────────────────────

describe("PaymentDetailPage 404 handling", () => {
  it("renders notFound() for an invalid (non-UUID) id without querying the API", () => {
    const errors: Error[] = [];
    renderPage("not-a-valid-id", (e) => errors.push(e));

    expect(mocks.notFound).toHaveBeenCalled();
    expect(errors[0]?.message).toBe("NEXT_NOT_FOUND");
    // Malformed ids must never reach the API.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders notFound() when the API returns 404 for an unknown id", async () => {
    const errors: Error[] = [];
    renderPage(VALID_ID, (e) => errors.push(e));

    expect(
      await screen.findByRole("status", { name: /loading payment/i })
    ).toBeInTheDocument();

    await act(async () => {
      resolveFetch?.(
        jsonResponse(404, {
          error: { code: "NOT_FOUND", message: "Payment not found" },
        })
      );
    });

    await waitFor(() => {
      expect(mocks.notFound).toHaveBeenCalled();
      expect(errors[0]?.message).toBe("NEXT_NOT_FOUND");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/payments/${VALID_ID}`,
      expect.anything()
    );
  });

  it("renders the payment details and a back link for an existing id", async () => {
    renderPage(VALID_ID);

    expect(
      await screen.findByRole("status", { name: /loading payment/i })
    ).toBeInTheDocument();

    await act(async () => {
      resolveFetch?.(
        jsonResponse(200, { success: true, data: payment })
      );
    });

    expect(await screen.findByText("250.00 XLM")).toBeInTheDocument();
    expect(screen.getByText("Invoice #42")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to payments/i })
    ).toHaveAttribute("href", "/payments");
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute(
      "href",
      "/payments"
    );
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
