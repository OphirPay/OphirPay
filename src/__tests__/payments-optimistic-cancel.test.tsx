// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import PaymentsPage from "@/app/payments/page";
import type { OnChainPayment } from "@/lib/contracts";

const mocks = vi.hoisted(() => ({
  fetchOnChainPayments: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/lib/contracts", () => ({
  fetchOnChainPayments: (...args: unknown[]) => mocks.fetchOnChainPayments(...args),
}));

const recordedPayment: OnChainPayment = {
  id: 1,
  payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  amountStroops: 10000000,
  txHash: "a".repeat(64),
  timestamp: 1700000000,
  metadata: "RECORDED",
};

const cancelledPayment: OnChainPayment = {
  id: 2,
  payer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  payee: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  amountStroops: 20000000,
  txHash: "b".repeat(64),
  timestamp: 1700000100,
  metadata: "CANCELLED",
};

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

beforeEach(() => {
  mocks.fetchOnChainPayments.mockReset();
  mocks.fetchMock.mockReset();
  global.fetch = mocks.fetchMock as unknown as typeof fetch;
  mocks.fetchOnChainPayments.mockResolvedValue({
    payments: [recordedPayment, cancelledPayment],
    total: 2,
  });
});

describe("PaymentsPage optimistic cancel (Issue #47)", () => {
  it("shows a cancel button for RECORDED payments but not CANCELLED ones", async () => {
    renderPage();
    await screen.findAllByRole("row");

    // The RECORDED payment should have a cancel button
    expect(
      screen.getByRole("button", { name: /cancel payment #1/i })
    ).toBeInTheDocument();

    // The CANCELLED payment should NOT have a cancel button
    expect(
      screen.queryByRole("button", { name: /cancel payment #2/i })
    ).not.toBeInTheDocument();
  });

  it("optimistically flips the status to CANCELLED on click, then reconciles on success", async () => {
    mocks.fetchMock.mockResolvedValue({ ok: true });

    renderPage();
    await screen.findAllByRole("row");

    const cancelBtn = screen.getByRole("button", { name: /cancel payment #1/i });
    fireEvent.click(cancelBtn);

    // Optimistic: status badge should now say CANCELLED for payment #1
    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1]; // skip header
      const statusCell = within(firstDataRow).getAllByRole("cell")[2];
      expect(statusCell.textContent).toContain("CANCELLED");
    });

    // The cancel button should no longer be visible (status is now CANCELLED)
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /cancel payment #1/i })
      ).not.toBeInTheDocument();
    });

    // Server was called
    expect(mocks.fetchMock).toHaveBeenCalledWith("/api/payments/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash: "a".repeat(64) }),
    });
  });

  it("rolls back to RECORDED on server failure and shows error toast", async () => {
    mocks.fetchMock.mockResolvedValue({ ok: false, status: 500 });

    renderPage();
    await screen.findAllByRole("row");

    const cancelBtn = screen.getByRole("button", { name: /cancel payment #1/i });
    fireEvent.click(cancelBtn);

    // Optimistic: briefly shows CANCELLED
    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const statusCell = within(firstDataRow).getAllByRole("cell")[2];
      expect(statusCell.textContent).toContain("CANCELLED");
    });

    // After rollback: should show RECORDED again
    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const statusCell = within(firstDataRow).getAllByRole("cell")[2];
      expect(statusCell.textContent).toContain("RECORDED");
    });

    // Cancel button should be visible again
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /cancel payment #1/i })
      ).toBeInTheDocument();
    });

    // Error toast should be visible
    await waitFor(() => {
      expect(screen.getByText("Failed to cancel payment")).toBeInTheDocument();
    });
  });

  it("rolls back to RECORDED on network error and shows error toast", async () => {
    mocks.fetchMock.mockRejectedValue(new TypeError("Network error"));

    renderPage();
    await screen.findAllByRole("row");

    const cancelBtn = screen.getByRole("button", { name: /cancel payment #1/i });
    fireEvent.click(cancelBtn);

    // After rollback: should show RECORDED again
    await waitFor(() => {
      const rows = screen.getAllByRole("row");
      const firstDataRow = rows[1];
      const statusCell = within(firstDataRow).getAllByRole("cell")[2];
      expect(statusCell.textContent).toContain("RECORDED");
    });

    // Error toast
    await waitFor(() => {
      expect(screen.getByText("Failed to cancel payment")).toBeInTheDocument();
    });
  });
});
