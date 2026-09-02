// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const { PAYMENTS } = vi.hoisted(() => {
  const payments = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    payer: `G${"A".repeat(55)}`,
    payee: `G${"B".repeat(55)}`,
    amountStroops: (i + 1) * 10000000,
    txHash: `${i + 1}234567890abcdef1234567890abcdef1234567890abcdef1234567890`,
    timestamp: 1700000000 + i,
  }));
  return { PAYMENTS: payments };
});

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
    payments: PAYMENTS,
    total: PAYMENTS.length,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>
  );
}

/**
 * Returns the payment rows inside <tbody> (excludes the header row),
 * waiting for the on-chain data to load so the loading skeleton is skipped.
 */
async function getRows(container: HTMLElement) {
  const tbody = container.querySelector("tbody");
  expect(tbody).not.toBeNull();
  return waitFor(() => {
    const rows = Array.from(
      (tbody as HTMLElement).querySelectorAll<HTMLElement>(
        "tr[data-row-index]"
      )
    );
    if (rows.length === 0) throw new Error("payment rows have not loaded yet");
    return rows;
  });
}

/** Focuses a row inside act() since focusing updates the roving tabindex. */
function focusRow(row: HTMLElement) {
  act(() => row.focus());
}

describe("PaymentsPage keyboard navigation", () => {
  it("makes the first row reachable via Tab and keeps the rest out of the tab order", async () => {
    const { container } = renderPage();

    const rows = await getRows(container);
    expect(rows).toHaveLength(PAYMENTS.length);

    // Roving tabindex: only the active row participates in tab order.
    expect(rows[0]).toHaveAttribute("tabindex", "0");
    for (const row of rows.slice(1)) {
      expect(row).toHaveAttribute("tabindex", "-1");
    }
  });

  it("renders focusable row actions (copy button + explorer link) with accessible names", async () => {
    renderPage();

    const copyButtons = await screen.findAllByRole("button", {
      name: /copy hash/i,
    });
    expect(copyButtons.length).toBe(PAYMENTS.length);
    for (const button of copyButtons) {
      expect(button).toBeEnabled();
    }

    const explorerLinks = await screen.findAllByRole("link", {
      name: /\.\.\./,
    });
    expect(explorerLinks.length).toBe(PAYMENTS.length);
    for (const link of explorerLinks) {
      expect(link).toHaveAttribute("href");
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("moves focus to the next row with ArrowDown and updates the tab order", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    focusRow(rows[0]);
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });

    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute("tabindex", "0");
    expect(rows[0]).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus to the previous row with ArrowUp", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    focusRow(rows[1]);
    fireEvent.keyDown(rows[1], { key: "ArrowUp" });

    expect(rows[0]).toHaveFocus();
    expect(rows[0]).toHaveAttribute("tabindex", "0");
  });

  it("jumps to the first and last rows with Home and End", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    focusRow(rows[2]);
    fireEvent.keyDown(rows[2], { key: "Home" });
    expect(rows[0]).toHaveFocus();

    fireEvent.keyDown(rows[0], { key: "End" });
    expect(rows[rows.length - 1]).toHaveFocus();
  });

  it("clamps at the table boundaries instead of wrapping", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);
    const last = rows.length - 1;

    focusRow(rows[0]);
    fireEvent.keyDown(rows[0], { key: "ArrowUp" });
    expect(rows[0]).toHaveFocus();

    focusRow(rows[last]);
    fireEvent.keyDown(rows[last], { key: "ArrowDown" });
    expect(rows[last]).toHaveFocus();
  });

  it("navigates rows from a focused row action button", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    const copy = screen.getAllByRole("button", { name: /copy hash/i })[0];
    fireEvent.keyDown(copy, { key: "ArrowDown" });

    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute("tabindex", "0");
  });

  it("activates a row when one of its action buttons receives focus", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    const copy = screen.getAllByRole("button", { name: /copy hash/i })[1];
    // Real browsers fire a bubbling `focusin` when a row action receives
    // focus (via Tab or click); simulate it directly in jsdom.
    fireEvent.focusIn(copy);

    expect(rows[1]).toHaveAttribute("tabindex", "0");
    expect(rows[0]).toHaveAttribute("tabindex", "-1");
  });

  it("highlights the active row with the theme's focus treatment", async () => {
    const { container } = renderPage();
    const rows = await getRows(container);

    expect(rows[0]).toHaveClass("bg-ophir-50/70");
    expect(rows[1]).not.toHaveClass("bg-ophir-50/70");

    fireEvent.keyDown(rows[0], { key: "ArrowDown" });

    expect(rows[1]).toHaveClass("bg-ophir-50/70");
    expect(rows[0]).not.toHaveClass("bg-ophir-50/70");
  });

  it("declares column headers with scope so screen readers map cells", async () => {
    renderPage();

    const headers = await screen.findAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Payment",
      "Amount",
      "Status",
      "Date",
      "Tx Hash",
    ]);
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });
});
