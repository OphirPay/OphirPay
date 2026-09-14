// SPDX-License-Identifier: MIT

import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RecurringPage from "@/app/recurring/page";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (url: unknown, opts: { method?: string } = {}) => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    method: opts.method ?? "POST",
  }),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: { connected: true, publicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
    fetchBalance: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: (addr: string) => /^G[A-Z0-9]{55}$/.test(addr),
}));

const mockRecurrences = [
  {
    id: "rec_1",
    name: "Monthly SaaS",
    frequency: "MONTHLY",
    amount: "50",
    assetCode: "XLM",
    destAddress: VALID_ADDRESS,
    description: null,
    isActive: true,
    nextRunAt: "2026-10-01T00:00:00.000Z",
    lastRunAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecurringPage />
    </QueryClientProvider>
  );
}

describe("RecurringPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockImplementation((key: string[]) =>
      key[0] === "recurring"
        ? { data: mockRecurrences, isLoading: false }
        : { data: [], isLoading: false }
    );
  });

  it("renders the recurring payment list with next and previous run dates", () => {
    renderPage();
    expect(screen.getByText("Monthly SaaS")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
    expect(screen.getByTestId("next-run-rec_1").textContent).toContain("Oct 1, 2026");
    expect(screen.getByTestId("prev-run-rec_1").textContent).toContain("Sep 1, 2026");
    expect(screen.getByText("50.00 XLM")).toBeTruthy();
  });

  it("shows empty state when there are no recurring payments", () => {
    mockUseApiQuery.mockImplementation((key: string[]) =>
      key[0] === "recurring" ? { data: [], isLoading: false } : { data: [], isLoading: false }
    );
    renderPage();
    expect(screen.getByText("No Recurring Payments Yet")).toBeTruthy();
  });

  it("creates a recurring payment via the create modal", async () => {
    mockMutateAsync.mockResolvedValue({ id: "rec_new" });
    renderPage();
    fireEvent.click(screen.getByText("+ New Recurring"));

    fireEvent.change(screen.getByTestId("recurring-name-input"), {
      target: { value: "Weekly Allowance" },
    });
    fireEvent.change(screen.getByTestId("recurring-payee-input"), {
      target: { value: VALID_ADDRESS },
    });
    fireEvent.change(screen.getByTestId("recurring-amount-input"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByTestId("recurring-frequency-input"), {
      target: { value: "WEEKLY" },
    });

    fireEvent.click(screen.getByTestId("recurring-create-btn"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    });
    const body = mockMutateAsync.mock.calls[0][0];
    expect(body.frequency).toBe("WEEKLY");
    expect(body.destAddress).toBe(VALID_ADDRESS);
    expect(body.amount).toBe(25);
    expect(body.name).toBe("Weekly Allowance");
    expect(body.sourceAccountId).toBe("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  });

  it("rejects creating with an invalid recipient address", async () => {
    renderPage();
    fireEvent.click(screen.getByText("+ New Recurring"));
    fireEvent.change(screen.getByTestId("recurring-name-input"), {
      target: { value: "Bad" },
    });
    fireEvent.change(screen.getByTestId("recurring-payee-input"), {
      target: { value: "not-a-valid-address" },
    });
    fireEvent.change(screen.getByTestId("recurring-amount-input"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByTestId("recurring-create-btn"));

    expect(
      await screen.findByTestId("recurring-form-error")
    ).toBeTruthy();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("cancels an active recurring payment", async () => {
    mockMutateAsync.mockResolvedValue({ cancelled: true });
    renderPage();
    const cancelButtons = screen.getAllByText("Cancel");
    fireEvent.click(cancelButtons[0]);
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: "rec_1",
      });
    });
  });

  it("shows the next-run preview when selecting a frequency", () => {
    renderPage();
    fireEvent.click(screen.getByText("+ New Recurring"));
    fireEvent.change(screen.getByTestId("recurring-frequency-input"), {
      target: { value: "MONTHLY" },
    });
    expect(screen.getByTestId("recurring-next-preview").textContent).toContain("Next run:");
  });
});
