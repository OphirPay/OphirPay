// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";

const { mockSearchParams } = vi.hoisted(() => ({
  mockSearchParams: { current: new URLSearchParams("") },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => mockSearchParams.current,
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
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
  }),
}));

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

    const copyButtons = await screen.findAllByRole(
      "button",
      {
        name: /copy hash/i,
      },
      { timeout: 5000 }
    );

    expect(copyButtons.length).toBeGreaterThan(0);
  });

  it("renders a page size selector defaulting to 25", async () => {
    renderPage();

    const select = await screen.findByRole(
      "combobox",
      { name: /page size/i },
      { timeout: 5000 }
    );
    expect(select).toHaveValue("25");
  });

  it("exports via the server-side export endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Payment ID,Memo\n1,hello", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    // jsdom would otherwise try to navigate on link.click().
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderPage();

    const exportButton = await screen.findByRole("button", { name: /csv/i });
    await userEvent.click(exportButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/payments/export"),
        expect.objectContaining({ credentials: "same-origin" })
      );
    });
    expect(anchorClick).toHaveBeenCalled();

    vi.unstubAllGlobals();
    anchorClick.mockRestore();
  });

  it("offers JSON export and forwards the active filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"count":0}', {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="ophirpay-payments-2026-08-26.json"',
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    mockSearchParams.current = new URLSearchParams(
      "status=COMPLETED&dateFrom=2026-01-01&dateTo=2026-01-31&asset=XLM"
    );
    renderPage();

    const exportButton = await screen.findByRole("button", {
      name: /export json/i,
    });
    await userEvent.click(exportButton);

    await waitFor(() => {
      const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
      expect(url).toContain("format=json");
      expect(url).toContain("status=COMPLETED");
      expect(url).toContain("dateFrom=2026-01-01");
      expect(url).toContain("dateTo=2026-01-31");
      expect(url).toContain("asset=XLM");
    });
    expect(anchorClick).toHaveBeenCalled();

    mockSearchParams.current = new URLSearchParams("");
    vi.unstubAllGlobals();
    anchorClick.mockRestore();
  });
});
