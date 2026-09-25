// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import {
  DEFAULT_OVERSCAN,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_VIEWPORT_HEIGHT,
} from "@/hooks/useVirtualRows";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const mocks = vi.hoisted(() => ({
  fetchOnChainPayments: vi.fn(),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: mocks.fetchOnChainPayments,
}));

const TABLE_SELECTOR = "table[aria-label='On-chain payments']";
const SCROLL_SELECTOR = "[data-testid='payments-table-scroll']";
const DEFAULT_PAGE_SIZE = 25;
/** Rows mounted for the default page size — the window, not the row set. */
const MOUNTED_ROWS =
  Math.ceil(DEFAULT_VIEWPORT_HEIGHT / DEFAULT_ROW_HEIGHT) + DEFAULT_OVERSCAN;

function makePayments(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    payer: `G${"A".repeat(55)}`,
    payee: `G${"B".repeat(55)}`,
    amountStroops: (i + 1) * 10000000,
    txHash: `${i + 1}`.padStart(64, "0"),
    timestamp: 1700000000 + i,
  }));
}

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

/** Returns the mounted data rows, waiting for the on-chain read to settle. */
async function getRows(container: HTMLElement) {
  return waitFor(() => {
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("tbody tr[data-row-index]")
    );
    if (rows.length === 0) throw new Error("payment rows have not loaded yet");
    return rows;
  });
}

function rowIndex(row: HTMLElement): number {
  return Number(row.dataset.rowIndex);
}

/** The "Showing 1–25 of 1000 on-chain records" footer line. */
function rangeText(container: HTMLElement): string {
  const paragraph = Array.from(container.querySelectorAll("p")).find((node) =>
    node.textContent?.includes("on-chain records")
  );
  return paragraph?.textContent ?? "";
}

/** jsdom reports no layout — give the scroll container real numbers. */
function scrollContainerTo(container: HTMLElement, clientHeight: number, scrollTop: number) {
  const scroller = container.querySelector(SCROLL_SELECTOR) as HTMLElement;
  Object.defineProperty(scroller, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(scroller, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  return scroller;
}

beforeEach(() => {
  mocks.fetchOnChainPayments.mockReset();
});

describe("PaymentsPage row virtualization", () => {
  beforeEach(() => {
    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(1000),
      total: 1000,
    });
  });

  it("mounts only a window of rows for a page that holds thousands", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    expect(rows).toHaveLength(MOUNTED_ROWS);
    expect(rows).toHaveLength(18);
    // The whole page is 25 rows, the record set is 1000 — neither is mounted.
    expect(rows.length).toBeLessThan(DEFAULT_PAGE_SIZE);
    expect(rowIndex(rows[0])).toBe(0);
    expect(rowIndex(rows[rows.length - 1])).toBe(MOUNTED_ROWS - 1);
  });

  it("mounts the same number of rows no matter how many records are loaded", async () => {
    const { container, unmount } = renderPage();
    await getRows(container);
    unmount();

    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(5000),
      total: 5000,
    });

    const second = renderPage();
    const rows = await getRows(second.container);
    expect(rows).toHaveLength(MOUNTED_ROWS);
  });

  it("replaces the unmounted rows with a spacer of the equivalent height", async () => {
    const { container } = renderPage();
    await getRows(container);

    const spacers = container.querySelectorAll<HTMLElement>("tbody tr[aria-hidden='true']");
    expect(spacers).toHaveLength(1);

    const expectedHeight = (DEFAULT_PAGE_SIZE - 1 - (MOUNTED_ROWS - 1)) * DEFAULT_ROW_HEIGHT;
    expect(spacers[0].querySelector("td")).toHaveStyle({ height: `${expectedHeight}px` });
  });

  it("keeps the spacer out of the accessibility tree", async () => {
    const { container } = renderPage();
    await getRows(container);

    // header + mounted data rows; the spacer must not be announced as a row.
    expect(screen.getAllByRole("row")).toHaveLength(MOUNTED_ROWS + 1);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(MOUNTED_ROWS + 1);
  });

  it("reports the full row count and each row's absolute position", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    const table = container.querySelector(TABLE_SELECTOR);
    expect(table).not.toBeNull();
    // 1000 records + the header row.
    expect(table).toHaveAttribute("aria-rowcount", "1001");

    const header = container.querySelector("thead tr");
    expect(header).toHaveAttribute("aria-rowindex", "1");
    expect(rows[0]).toHaveAttribute("aria-rowindex", "2");
    expect(rows[rows.length - 1]).toHaveAttribute("aria-rowindex", String(MOUNTED_ROWS + 1));
  });

  it("renders every row, and no spacer, when the record set is small", async () => {
    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(4),
      total: 4,
    });

    const { container } = renderPage();
    const rows = await getRows(container);

    expect(rows).toHaveLength(4);
    expect(container.querySelectorAll("tbody tr[aria-hidden='true']")).toHaveLength(0);
    expect(container.querySelector(TABLE_SELECTOR)).toHaveAttribute("aria-rowcount", "5");
  });
});

describe("PaymentsPage load more", () => {
  it("appends one page per click without mounting more rows", async () => {
    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(1000),
      total: 1000,
    });

    const { container } = renderPage();
    await getRows(container);

    expect(rangeText(container)).toContain("Showing 1–25 of 1000 on-chain records");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    // One more page is loaded …
    expect(rangeText(container)).toContain("Showing 1–50 of 1000 on-chain records");
    // … but the DOM still holds a single window.
    expect(await getRows(container)).toHaveLength(MOUNTED_ROWS);
  });

  it("disappears once the whole result set is loaded", async () => {
    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(30),
      total: 30,
    });

    const { container } = renderPage();
    await getRows(container);

    const loadMore = screen.getByRole("button", { name: "Load more" });
    await act(async () => {
      fireEvent.click(loadMore);
    });

    expect(rangeText(container)).toContain("Showing 1–30 of 30 on-chain records");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("does not offer Load more when the page already holds every record", async () => {
    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(3),
      total: 3,
    });

    const { container } = renderPage();
    await getRows(container);

    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("PaymentsPage keyboard navigation across the virtual window", () => {
  beforeEach(() => {
    mocks.fetchOnChainPayments.mockResolvedValue({
      payments: makePayments(1000),
      total: 1000,
    });
  });

  it("scrolls the window to the next row when ArrowDown leaves the mounted range", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    const lastMounted = rows[rows.length - 1];
    act(() => lastMounted.focus());
    fireEvent.keyDown(lastMounted, { key: "ArrowDown" });

    const next = await waitFor(() => {
      const row = container.querySelector<HTMLElement>(
        `tbody tr[data-row-index="${MOUNTED_ROWS}"]`
      );
      if (!row) throw new Error("the window has not moved yet");
      return row;
    });

    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("tabindex", "0");
    // The window advanced, so the first row is no longer mounted.
    expect(
      container.querySelector("tbody tr[data-row-index='0']")
    ).not.toBeInTheDocument();
  });

  it("moves focus with ArrowUp back into the window", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    act(() => rows[1].focus());
    fireEvent.keyDown(rows[1], { key: "ArrowUp" });

    const first = container.querySelector<HTMLElement>("tbody tr[data-row-index='0']");
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("tabindex", "0");
  });

  it("jumps to the last loaded row with End", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    act(() => rows[0].focus());
    fireEvent.keyDown(rows[0], { key: "End" });

    const last = await waitFor(() => {
      const row = container.querySelector<HTMLElement>(
        `tbody tr[data-row-index="${DEFAULT_PAGE_SIZE - 1}"]`
      );
      if (!row) throw new Error("the window has not moved yet");
      return row;
    });

    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-rowindex", String(DEFAULT_PAGE_SIZE + 1));
  });

  it("keeps the roving tabindex on a mounted row when the window scrolls away", async () => {
    const { container } = renderPage();
    await getRows(container);

    // Scroll far enough that the active row (index 0) leaves the window.
    const scroller = scrollContainerTo(container, 600, 900);
    fireEvent.scroll(scroller);

    const firstMounted = await waitFor(() => {
      const row = container.querySelector<HTMLElement>("tbody tr[data-row-index]");
      if (!row || rowIndex(row) === 0) throw new Error("the window has not moved yet");
      return row;
    });

    expect(firstMounted).toHaveAttribute("tabindex", "0");
    expect(
      container.querySelector("tbody tr[data-row-index='0']")
    ).not.toBeInTheDocument();
  });
});
