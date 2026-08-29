// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/Toast";
import RecurringPage from "@/app/recurring/page";

const mockWallet = {
  connected: true,
  publicKey: "GBZX4364PEPQTDICMIQDZ56K4T75QGKCRFHSVJFVODVFBRR6XOQNFB2C",
  network: "TESTNET",
  balance: "1000",
  balanceLoading: false,
  activeWalletId: "freighter",
};

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: mockWallet,
    connect: vi.fn(),
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
    availableWallets: ["freighter"],
  }),
}));

vi.mock("@/lib/contract-advanced", () => ({
  createRecurringPayment: vi.fn().mockResolvedValue({ success: true, data: 42 }),
  cancelRecurringPayment: vi.fn().mockResolvedValue({ success: true }),
  executeRecurringPayment: vi.fn().mockResolvedValue({ success: true }),
  simulateExecuteRecurring: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {ui}
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("RecurringPage Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders recurring page with empty state initially", () => {
    renderWithClient(<RecurringPage />);
    expect(screen.getByRole("heading", { name: "Recurring Payments" })).toBeInTheDocument();
    expect(screen.getByText("No Recurring Payments Yet")).toBeInTheDocument();
  });

  it("opens create modal and shows next-run preview dynamically", async () => {
    renderWithClient(<RecurringPage />);

    // Click "+ New Recurring"
    fireEvent.click(screen.getByTestId("create-recurring-btn"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create Recurring Payment" })).toBeInTheDocument();

    // Verify next-run preview exists
    const preview = screen.getByTestId("next-run-preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveTextContent(/Every 24 hours \(Daily\)/);

    // Switch schedule to Weekly
    const scheduleSelect = screen.getByTestId("schedule-select");
    fireEvent.change(scheduleSelect, { target: { value: "Weekly" } });
    expect(preview).toHaveTextContent(/Every 7 days \(Weekly\)/);

    // Switch schedule to Monthly
    fireEvent.change(scheduleSelect, { target: { value: "Monthly" } });
    expect(preview).toHaveTextContent(/Every 30 days \(Monthly\)/);

    // Enter amount and remaining runs to verify total volume preview
    const amountInput = screen.getByTestId("amount-input");
    const remainingInput = screen.getByTestId("remaining-input");
    fireEvent.change(amountInput, { target: { value: "50" } });
    fireEvent.change(remainingInput, { target: { value: "10" } });
    expect(preview).toHaveTextContent(/Total Volume: 500.00 XLM/);
  });

  it("creates a new recurring schedule and adds it to the list", async () => {
    renderWithClient(<RecurringPage />);

    fireEvent.click(screen.getByTestId("create-recurring-btn"));

    const recipientInput = screen.getByTestId("recipient-input");
    const amountInput = screen.getByTestId("amount-input");
    const scheduleSelect = screen.getByTestId("schedule-select");
    const remainingInput = screen.getByTestId("remaining-input");

    fireEvent.change(recipientInput, { target: { value: "GBZX4364PEPQTDICMIQDZ56K4T75QGKCRFHSVJFVODVFBRR6XOQNFB2C" } });
    fireEvent.change(amountInput, { target: { value: "100.5" } });
    fireEvent.change(scheduleSelect, { target: { value: "Weekly" } });
    fireEvent.change(remainingInput, { target: { value: "5" } });

    fireEvent.click(screen.getByTestId("submit-create-btn"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Card should appear in list
    expect(screen.getByTestId("recurring-card")).toBeInTheDocument();
    expect(screen.getByTestId("recurring-status-badge")).toHaveTextContent("Active");
    expect(screen.getByTestId("recurring-amount-display")).toHaveTextContent("100.5 XLM");
    expect(screen.getByTestId("remaining-count")).toHaveTextContent("5 left");
    expect(screen.getByTestId("execution-count")).toHaveTextContent("Executed: 0×");
  });

  it("covers pause and resume lifecycle", async () => {
    renderWithClient(<RecurringPage />);

    // Create schedule
    fireEvent.click(screen.getByTestId("create-recurring-btn"));
    fireEvent.change(screen.getByTestId("recipient-input"), { target: { value: "GABC123456789" } });
    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("submit-create-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("recurring-status-badge")).toHaveTextContent("Active");
    });

    // Click Pause
    const pauseBtn = screen.getByTestId("pause-recurring-btn");
    expect(pauseBtn).toBeInTheDocument();
    fireEvent.click(pauseBtn);

    // Status is now Paused
    expect(screen.getByTestId("recurring-status-badge")).toHaveTextContent("Paused");
    expect(screen.queryByTestId("pause-recurring-btn")).not.toBeInTheDocument();

    // Click Resume
    const resumeBtn = screen.getByTestId("resume-recurring-btn");
    expect(resumeBtn).toBeInTheDocument();
    fireEvent.click(resumeBtn);

    // Status is back to Active
    expect(screen.getByTestId("recurring-status-badge")).toHaveTextContent("Active");
    expect(screen.getByTestId("pause-recurring-btn")).toBeInTheDocument();
  });

  it("simulates execution and verifies execution history is updated in UI", async () => {
    renderWithClient(<RecurringPage />);

    // Create schedule with 2 runs
    fireEvent.click(screen.getByTestId("create-recurring-btn"));
    fireEvent.change(screen.getByTestId("recipient-input"), { target: { value: "GDEF987654321" } });
    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "75" } });
    fireEvent.change(screen.getByTestId("remaining-input"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("submit-create-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("execution-count")).toHaveTextContent("Executed: 0×");
    });

    // Expand history drawer
    fireEvent.click(screen.getByTestId("toggle-history-btn"));
    expect(screen.getByTestId("execution-history")).toBeInTheDocument();
    expect(screen.getByTestId("empty-history")).toHaveTextContent(/No executions recorded yet/);

    // Simulate first execution
    const simulateBtn = screen.getByTestId("simulate-execution-btn");
    fireEvent.click(simulateBtn);

    expect(screen.getByTestId("execution-count")).toHaveTextContent("Executed: 1×");
    expect(screen.getByTestId("remaining-count")).toHaveTextContent("1 left");

    // History now contains the record
    const records = screen.getAllByTestId("execution-record");
    expect(records.length).toBe(1);
    expect(records[0]).toHaveTextContent("75 XLM");
    expect(records[0]).toHaveTextContent("Success");

    // Simulate second execution
    fireEvent.click(simulateBtn);
    expect(screen.getByTestId("execution-count")).toHaveTextContent("Executed: 2×");
    expect(screen.getByTestId("remaining-count")).toHaveTextContent("0 left");
    expect(screen.getAllByTestId("execution-record").length).toBe(2);
  });

  it("cancels recurring payment schedule", async () => {
    renderWithClient(<RecurringPage />);

    fireEvent.click(screen.getByTestId("create-recurring-btn"));
    fireEvent.change(screen.getByTestId("recipient-input"), { target: { value: "GXYZ00000000" } });
    fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByTestId("submit-create-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("cancel-recurring-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("cancel-recurring-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("recurring-status-badge")).toHaveTextContent("Cancelled");
    });
  });
});
