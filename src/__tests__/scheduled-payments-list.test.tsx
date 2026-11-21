// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ScheduledPaymentsList, {
  ScheduledPaymentRow,
} from "@/components/ScheduledPaymentsList";

const { useApiQueryMock, useApiMutationMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    useApiQueryMock: vi.fn(),
    useApiMutationMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: useApiQueryMock,
  useApiMutation: useApiMutationMock,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

const mockPayments: ScheduledPaymentRow[] = [
  {
    id: "sp-1",
    amount: "150.5",
    assetCode: "XLM",
    destAddress: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    memo: "Monthly server hosting",
    scheduledAt: "2026-12-01T10:00:00Z",
    status: "SCHEDULED",
  },
  {
    id: "sp-2",
    amount: "500",
    assetCode: "USDC",
    destAddress: "GBV36OWOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJKK89",
    memo: "Marketing retainer",
    scheduledAt: "2026-12-05T12:00:00Z",
    status: "PROCESSING",
  },
  {
    id: "sp-3",
    amount: "25",
    assetCode: "XLM",
    destAddress: "GCDQYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UQWER1",
    memo: null,
    scheduledAt: "2026-11-20T09:00:00Z",
    status: "EXECUTED",
  },
];

describe("ScheduledPaymentsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApiMutationMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  it("renders loading state when isLoading is true", () => {
    useApiQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { container } = render(<ScheduledPaymentsList />);
    expect(screen.getByText("Scheduled Payments")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2);
  });

  it("renders empty state message when there are no scheduled payments", () => {
    useApiQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
    });

    render(<ScheduledPaymentsList />);
    expect(
      screen.getByText(/No scheduled payments yet/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Search by recipient address or memo/i)
    ).not.toBeInTheDocument();
  });

  it("renders payments and search input when payments exist", () => {
    useApiQueryMock.mockReturnValue({
      data: mockPayments,
      isLoading: false,
    });

    render(<ScheduledPaymentsList />);
    expect(screen.getByText("3 upcoming")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Search by recipient address or memo/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Monthly server hosting/i)).toBeInTheDocument();
    expect(screen.getByText(/Marketing retainer/i)).toBeInTheDocument();
  });

  it("filters payments in real-time by memo (case-insensitive)", () => {
    useApiQueryMock.mockReturnValue({
      data: mockPayments,
      isLoading: false,
    });

    render(<ScheduledPaymentsList />);
    const searchInput = screen.getByPlaceholderText(
      /Search by recipient address or memo/i
    );

    fireEvent.change(searchInput, { target: { value: "server" } });

    expect(screen.getByText("1 of 3 matching")).toBeInTheDocument();
    expect(screen.getByText(/Monthly server hosting/i)).toBeInTheDocument();
    expect(screen.queryByText(/Marketing retainer/i)).not.toBeInTheDocument();
  });

  it("filters payments in real-time by destination address", () => {
    useApiQueryMock.mockReturnValue({
      data: mockPayments,
      isLoading: false,
    });

    render(<ScheduledPaymentsList />);
    const searchInput = screen.getByPlaceholderText(
      /Search by recipient address or memo/i
    );

    fireEvent.change(searchInput, { target: { value: "GBV36OW" } });

    expect(screen.getByText("1 of 3 matching")).toBeInTheDocument();
    expect(screen.getByText(/Marketing retainer/i)).toBeInTheDocument();
    expect(screen.queryByText(/Monthly server hosting/i)).not.toBeInTheDocument();
  });

  it("shows EmptyState when no payments match search query and clears search on action", () => {
    useApiQueryMock.mockReturnValue({
      data: mockPayments,
      isLoading: false,
    });

    render(<ScheduledPaymentsList />);
    const searchInput = screen.getByPlaceholderText(
      /Search by recipient address or memo/i
    );

    fireEvent.change(searchInput, { target: { value: "nonexistent-query" } });

    expect(screen.getByText("0 of 3 matching")).toBeInTheDocument();
    expect(screen.getByText("No matching payments")).toBeInTheDocument();
    expect(
      screen.getByText(/No scheduled payments found matching "nonexistent-query"/i)
    ).toBeInTheDocument();

    const clearActionBtn = screen.getByRole("button", { name: "Clear search" });
    fireEvent.click(clearActionBtn);

    expect(screen.getByText("3 upcoming")).toBeInTheDocument();
    expect(screen.getByText(/Monthly server hosting/i)).toBeInTheDocument();
  });

  it("clears search input via clear icon button", () => {
    useApiQueryMock.mockReturnValue({
      data: mockPayments,
      isLoading: false,
    });

    render(<ScheduledPaymentsList />);
    const searchInput = screen.getByPlaceholderText(
      /Search by recipient address or memo/i
    );

    fireEvent.change(searchInput, { target: { value: "marketing" } });
    expect(screen.getByDisplayValue("marketing")).toBeInTheDocument();

    const clearIconButton = screen.getByLabelText("Clear search query");
    fireEvent.click(clearIconButton);

    expect(screen.getByDisplayValue("")).toBeInTheDocument();
    expect(screen.getByText("3 upcoming")).toBeInTheDocument();
  });
});
