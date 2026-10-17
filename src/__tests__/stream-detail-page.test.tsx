// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const RECIPIENT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const CREATOR = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const mocks = vi.hoisted(() => ({
  refetch: vi.fn().mockResolvedValue(undefined),
  claimStream: vi.fn().mockResolvedValue({ success: true }),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
}));

vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: () => ({
    data: {
      id: 7,
      creator: CREATOR,
      recipient: RECIPIENT,
      total_amount: "1000000000",
      claimed_amount: "0",
      start_time: 1_000_000,
      end_time: 1_001_000,
      cancelled: false,
      metadata: "Payroll",
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({ wallet: { publicKey: RECIPIENT } }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

vi.mock("@/lib/contract-advanced", () => ({
  claimStream: mocks.claimStream,
}));

import StreamDetailPage from "@/app/streams/[id]/page";

describe("StreamDetailPage (issue #1377)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetch.mockResolvedValue(undefined);
    mocks.claimStream.mockResolvedValue({ success: true });
  });

  it("renders the vesting chart and stream metadata", () => {
    render(<StreamDetailPage />);

    expect(screen.getByRole("heading", { name: /Stream #7/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /stream vesting/i })).toBeInTheDocument();
    expect(screen.getByText("Payroll")).toBeInTheDocument();
  });

  it("claims the stream as the recipient and refreshes the data", async () => {
    render(<StreamDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: /claim vested tokens/i }));

    await waitFor(() =>
      expect(mocks.claimStream).toHaveBeenCalledWith(RECIPIENT, 7)
    );
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled());
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("surfaces a failed claim instead of refreshing", async () => {
    mocks.claimStream.mockResolvedValue({ success: false, error: "unauthorized" });
    render(<StreamDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: /claim vested tokens/i }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Claim failed",
        "unauthorized"
      )
    );
    expect(mocks.refetch).not.toHaveBeenCalled();
  });
});
