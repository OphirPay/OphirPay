// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Horizon } from "@stellar/stellar-sdk";
import * as stellarLib from "@/lib/stellar";
import { resetFeeCache } from "@/lib/fee-estimator";
import NewBatchPage from "@/app/batches/new/page";

const { signTransaction } = vi.hoisted(() => ({
  signTransaction: vi.fn().mockResolvedValue("SIGNED_XDR"),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      balance: "1000.00",
      activeWalletId: "freighter",
    },
  }),
}));
vi.mock("@/lib/wallets", () => ({
  getWalletConnector: () => ({ signTransaction }),
}));
vi.mock("@/components/ui/CopyButton", () => ({ CopyButton: () => null }));

const A = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
const B = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

const stats = {
  last_ledger: "1",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.9",
  fee_charged: { mode: "100", p70: "250", p95: "1200" },
};

async function openConfirmWithTwoRecipients() {
  render(<NewBatchPage />);
  fireEvent.click(screen.getByText("Add Recipient"));
  const addrs = screen.getAllByPlaceholderText("G... destination address");
  const amounts = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(addrs[0], { target: { value: A } });
  fireEvent.change(amounts[0], { target: { value: "1" } });
  fireEvent.change(addrs[1], { target: { value: B } });
  fireEvent.change(amounts[1], { target: { value: "2" } });
  fireEvent.click(screen.getByText("Send Batch Payment"));
  return screen.findByRole("dialog");
}

describe("Batch confirmation fee recommendation (#825)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetFeeCache();
    signTransaction.mockResolvedValue("SIGNED_XDR");
    vi.spyOn(stellarLib, "submitSignedTx").mockResolvedValue({ hash: "h", successful: true });
  });

  it("shows the per-recipient fee, total and basis, and submits that exact fee", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      feeStats: vi.fn().mockResolvedValue(stats),
    } as never);
    const build = vi.spyOn(stellarLib, "buildBatchPaymentTx").mockImplementation(async (p) => ({
      xdr: "BATCH_XDR",
      sourceAccount: {} as unknown as Horizon.AccountResponse,
      fee: String(Number(p.fee) * p.recipients.length),
    }));

    await openConfirmWithTwoRecipients();

    // 2 ops × 250 stroops = 500 stroops = 0.000050 XLM
    await waitFor(() =>
      expect(screen.getByTestId("fee-total").textContent).toContain("0.00005 XLM (250 stroops × 2 operations)")
    );
    expect(screen.getByTestId("fee-basis").textContent).toContain("Higher than the 100 stroop base fee");

    fireEvent.click(screen.getByTestId("batch-confirm-send"));

    await waitFor(() => expect(signTransaction).toHaveBeenCalledWith("BATCH_XDR", expect.anything()));
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ fee: "250" }));
  });

  it("shows a visible fallback indication when Horizon is unreachable", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      feeStats: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as never);

    await openConfirmWithTwoRecipients();

    expect((await screen.findByTestId("fee-stale-warning")).textContent).toContain("Horizon is unreachable");
    expect(screen.getByTestId("fee-total").textContent).toContain("100 stroops × 2 operations");
  });

  it("refuses to sign when the built fee differs from the confirmed fee", async () => {
    vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
      feeStats: vi.fn().mockResolvedValue(stats),
    } as never);
    vi.spyOn(stellarLib, "buildBatchPaymentTx").mockResolvedValue({
      xdr: "BATCH_XDR",
      sourceAccount: {} as unknown as Horizon.AccountResponse,
      fee: "1",
    });

    await openConfirmWithTwoRecipients();
    await waitFor(() => expect(screen.getByTestId("fee-total").textContent).toContain("250 stroops"));
    fireEvent.click(screen.getByTestId("batch-confirm-send"));

    expect(await screen.findByText(/does not match the fee shown/)).toBeTruthy();
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
