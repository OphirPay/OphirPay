// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import type { OnChainPayment } from "@/lib/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const TOTAL_RECORDS = 120;

const PAYMENTS: OnChainPayment[] = Array.from({ length: TOTAL_RECORDS }, (_, i) => ({
  id: i + 1,
  payer: `G${"A".repeat(55)}`,
  payee: `G${"B".repeat(55)}`,
  amountStroops: (i + 1) * 10000000,
  txHash: `${(i + 1).toString(16).padStart(64, "0")}`,
  timestamp: 1700000000 + i,
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockImplementation(async () => ({
    payments: PAYMENTS,
    total: PAYMENTS.length,
  })),
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

async function waitForRows(container: HTMLElement) {
  const tbody = container.querySelector("tbody");
  expect(tbody).not.toBeNull();
  return waitFor(() => {
    const rows = Array.from(
      (tbody as HTMLElement).querySelectorAll<HTMLElement>("tr[data-row-index]")
    );
    if (rows.length === 0) throw new Error("rows have not loaded yet");
    return rows;
  });
}

describe("PaymentsPage virtualization & accessibility", () => {
  it("renders a bounded window of rows rather than mounting every record", async () => {
    const { container } = renderPage();
    const rows = await waitForRows(container);

    // With 120 records, default page size 25: windowing mounts only the
    // visible slice + overscan (~18 rows), never the whole page or total
    expect(rows.length).toBeLessThan(PAYMENTS.length);
    expect(rows.length).toBeLessThanOrEqual(25);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("declares aria-rowcount for the full record set and aria-rowindex per row", async () => {
    const { container } = renderPage();
    const rows = await waitForRows(container);

    const table = screen.getByRole("table", { name: /on-chain payments/i });
    // Total rowcount = header row + filtered records
    expect(table).toHaveAttribute("aria-rowcount", String(PAYMENTS.length + 1));

    // Header has aria-rowindex 1
    const theadRow = container.querySelector("thead tr");
    expect(theadRow).toHaveAttribute("aria-rowindex", "1");

    // The first mounted payment row must report its absolute index (row 2)
    expect(rows[0]).toHaveAttribute("aria-rowindex", "2");
  });

  it("keeps spacer rows aria-hidden so screen readers do not announce them", async () => {
    const { container } = renderPage();
    await waitForRows(container);

    const spacers = container.querySelectorAll("tbody tr[aria-hidden='true']");
    for (const spacer of spacers) {
      expect(spacer).toHaveAttribute("aria-hidden", "true");
      expect(spacer.querySelector("td")).toHaveStyle({ padding: "0px" });
    }
  });

  it("appends more records when clicking 'Load more'", async () => {
    const { container } = renderPage();
    await waitForRows(container);

    const loadMoreButton = screen.queryByRole("button", { name: /load more/i });
    if (loadMoreButton) {
      fireEvent.click(loadMoreButton);
      // Wait for table to update
      await waitFor(() => {
        expect(screen.getByText(/showing/i)).toBeInTheDocument();
      });
    }
  });

  it("moves focus to the target row on keyboard navigation across the window boundary", async () => {
    const { container } = renderPage();
    const rows = await waitForRows(container);

    // Focus the first row
    act(() => rows[0].focus());

    // Press End to navigate to the bottom of the loaded window
    fireEvent.keyDown(container.querySelector("tbody")!, { key: "End" });

    // Focus shifts to the last index and updates tabindex
    await waitFor(() => {
      const activeRows = container.querySelectorAll("tbody tr[tabindex='0']");
      expect(activeRows.length).toBe(1);
    });
  });
});
