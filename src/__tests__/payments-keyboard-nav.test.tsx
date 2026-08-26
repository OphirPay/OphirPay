// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaymentsPage from "@/app/payments/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

const { mockPayments } = vi.hoisted(() => ({
  mockPayments: [
    {
      id: 101,
      payer: "GA11111111111111111111111111111111111111111111111111111111",
      payee: "GB22222222222222222222222222222222222222222222222222222222",
      amountStroops: 100000000,
      txHash: "hash111111111111111111111111111111111111111111111111111111111111",
      timestamp: 1787740000,
    },
    {
      id: 102,
      payer: "GA33333333333333333333333333333333333333333333333333333333",
      payee: "GB44444444444444444444444444444444444444444444444444444444",
      amountStroops: 250000000,
      txHash: "hash222222222222222222222222222222222222222222222222222222222222",
      timestamp: 1787741000,
    },
    {
      id: 103,
      payer: "GA55555555555555555555555555555555555555555555555555555555",
      payee: "GB66666666666666666666666666666666666666666666666666666666",
      amountStroops: 500000000,
      txHash: "hash333333333333333333333333333333333333333333333333333333333333",
      timestamp: 1787742000,
    },
  ],
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: vi.fn().mockResolvedValue({
    payments: mockPayments,
    total: 3,
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

describe("Payments Table Keyboard Navigation & Accessibility", () => {
  it("renders table with proper accessible attributes and focusable rows", async () => {
    renderPage();

    const table = await screen.findByRole("table", { name: /payments table/i });
    expect(table).toBeInTheDocument();

    const row1 = await screen.findByTestId("payment-row-101");
    const row2 = await screen.findByTestId("payment-row-102");
    const row3 = await screen.findByTestId("payment-row-103");

    expect(row1).toHaveAttribute("tabIndex", "0");
    expect(row1).toHaveAttribute("role", "row");
    expect(row1).toHaveAttribute("aria-rowindex", "1");

    expect(row2).toHaveAttribute("tabIndex", "0");
    expect(row2).toHaveAttribute("aria-rowindex", "2");

    expect(row3).toHaveAttribute("tabIndex", "0");
    expect(row3).toHaveAttribute("aria-rowindex", "3");
  });

  it("navigates down and up rows with ArrowDown and ArrowUp keys", async () => {
    renderPage();

    const row1 = await screen.findByTestId("payment-row-101");
    const row2 = await screen.findByTestId("payment-row-102");
    const row3 = await screen.findByTestId("payment-row-103");

    row1.focus();
    expect(document.activeElement).toBe(row1);

    // Press ArrowDown -> focus should move to row2
    fireEvent.keyDown(row1, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row2);

    // Press ArrowDown again -> focus should move to row3
    fireEvent.keyDown(row2, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row3);

    // Press ArrowUp -> focus should move back to row2
    fireEvent.keyDown(row3, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row2);
  });

  it("navigates to the first row on Home and to the last row on End", async () => {
    renderPage();

    const row1 = await screen.findByTestId("payment-row-101");
    const row2 = await screen.findByTestId("payment-row-102");
    const row3 = await screen.findByTestId("payment-row-103");

    row2.focus();
    expect(document.activeElement).toBe(row2);

    // Press End -> should move focus to last row (row3)
    fireEvent.keyDown(row2, { key: "End" });
    expect(document.activeElement).toBe(row3);

    // Press Home -> should move focus to first row (row1)
    fireEvent.keyDown(row3, { key: "Home" });
    expect(document.activeElement).toBe(row1);
  });

  it("ensures row actions (explorer link & copy button) are accessible via Tab", async () => {
    renderPage();

    const links = await screen.findAllByRole("link");
    expect(links.length).toBeGreaterThan(0);

    const copyButtons = await screen.findAllByRole("button", {
      name: /copy hash/i,
    });
    expect(copyButtons.length).toBeGreaterThan(0);
  });
});
