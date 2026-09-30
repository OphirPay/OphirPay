// SPDX-License-Identifier: MIT

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StreamsPage from "@/app/streams/page";

const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockWalletAddress = vi.hoisted(() => ({
  value: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
}));
const mockCreateStream = vi.hoisted(() => vi.fn());
const mockClaimStream = vi.hoisted(() => vi.fn());
const mockCancelStream = vi.hoisted(() => vi.fn());
const mockSuccess = vi.hoisted(() => vi.fn());
const mockError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: mockWalletAddress.value,
    },
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: mockSuccess, error: mockError }),
}));

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));

vi.mock("@/lib/contract-advanced", () => ({
  createStream: mockCreateStream,
  claimStream: mockClaimStream,
  cancelStream: mockCancelStream,
}));

vi.mock("@/lib/on-chain-records", () => ({
  fetchRecentContractRecords: vi.fn(),
}));

vi.mock("@/lib/stellar", () => ({
  isValidStellarAddress: () => true,
}));

const creator = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const recipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const stream = {
  id: 7,
  creator,
  recipient,
  total_amount: BigInt(100_000_000),
  claimed_amount: BigInt(20_000_000),
  asset: "native",
  start_time: 1_000,
  end_time: 1_100,
  cancelled: false,
  metadata: "Monthly contributor grant",
};

describe("StreamsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_050_000));
    vi.clearAllMocks();
    mockWalletAddress.value = recipient;
    mockUseApiQuery.mockReturnValue({
      data: [stream],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockClaimStream.mockResolvedValue({ success: true });
    mockCancelStream.mockResolvedValue({ success: true });
    mockCreateStream.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows live vesting progress and claimable amount to the recipient", async () => {
    render(<StreamsPage />);

    expect(screen.getByRole("heading", { name: "Stream #7" })).toBeTruthy();
    expect(screen.getByText((_, element) =>
      element?.tagName === "SPAN" && element.textContent?.includes("5.00 XLM"),
    )).toBeTruthy();
    expect(screen.getByText((_, element) =>
      element?.tagName === "SPAN" && element.textContent?.includes("2.00 XLM"),
    )).toBeTruthy();
    expect(screen.getByText((_, element) =>
      element?.tagName === "P" && element.textContent?.includes("Claimable now: 3.00 XLM"),
    )).toBeTruthy();
    expect(screen.getByText("Monthly contributor grant")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Claim vested tokens"));
    });
    expect(mockClaimStream).toHaveBeenCalledWith(recipient, 7);
  });

  it("lets the creator cancel an active stream", async () => {
    mockWalletAddress.value = creator;
    render(<StreamsPage />);

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel stream"));
    });

    expect(mockCancelStream).toHaveBeenCalledWith(creator, 7);
    expect(mockSuccess).toHaveBeenCalledWith(
      "Stream 7 cancelled; vested tokens were paid to the recipient and the remainder returned.",
    );
  });

  it("creates a stream with exact stroops and Unix-second schedule values", async () => {
    vi.useRealTimers();
    mockUseApiQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<StreamsPage />);
    fireEvent.click(screen.getByText("+ Create stream"));
    fireEvent.change(screen.getByLabelText("Recipient Stellar address"), {
      target: { value: recipient },
    });
    fireEvent.change(screen.getByLabelText("Total amount (XLM)"), {
      target: { value: "1.25" },
    });
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "2030-01-01T00:00" },
    });
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "2030-01-02T00:00" },
    });
    fireEvent.click(screen.getByText("Sign and create stream"));

    await waitFor(() => {
      expect(mockCreateStream).toHaveBeenCalledWith(
        recipient,
        recipient,
        BigInt(12_500_000),
        "native",
        Math.floor(new Date("2030-01-01T00:00").getTime() / 1000),
        Math.floor(new Date("2030-01-02T00:00").getTime() / 1000),
        "",
      );
    });
  });
});
