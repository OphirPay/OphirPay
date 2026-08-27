// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";
import { ToastProvider } from "@/components/ui/Toast";
import type { Payment } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const payment: Payment = {
  id: "cm1234567890123456789012",
  amount: 100,
  status: "CREATED",
  assetCode: "XLM",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
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

const fetchMock = vi.fn();
let resolveList: ((value: ReturnType<typeof jsonResponse>) => void) | null;

beforeEach(() => {
  fetchMock.mockReset();
  resolveList = null;
  fetchMock.mockImplementation(
    () =>
      new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
        resolveList = resolve;
      })
  );
  vi.stubGlobal("fetch", fetchMock);
});
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

describe("PaymentsPage loading skeleton", () => {
  it("renders a skeleton while the list is pending, then content after it resolves", async () => {
    const { container } = renderPage();

    // While the query is pending: pulsing skeleton rows are visible and no
    // payment data has rendered yet.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Invoice #42/i)).not.toBeInTheDocument();

    await act(async () => {
      resolveList?.(
        jsonResponse(200, {
          success: true,
          data: [payment],
          meta: { page: 1, limit: 100, total: 1 },
        })
      );
    });

    // Skeleton disappears cleanly and the payment row renders in its place.
    await waitFor(() => {
      expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
    });
    expect(screen.getByText("Invoice #42")).toBeInTheDocument();
    expect(screen.getByText("1 payment")).toBeInTheDocument();
  });
});
