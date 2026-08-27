// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  amount: 250,
  status: "SIGNED",
  assetCode: "XLM",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-02T12:00:00.000Z",
  description: "Invoice #42",
  transactionHash:
    "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/csrf") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "test-csrf" }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [payment] }),
    };
  });
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

describe("PaymentsPage", () => {
  it("renders a copy button next to each transaction hash", async () => {
    renderPage();

    const copyButtons = await screen.findAllByRole("button", {
      name: /copy hash/i,
    });

    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it("renders a page size selector defaulting to 25", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", { name: /page size/i });
    expect(select).toHaveValue("25");
  });
});
