// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Horizon } from "@stellar/stellar-sdk";
import SendPage from "@/app/send/page";
import * as stellarLib from "@/lib/stellar";
import { resetFeeCache } from "@/lib/fee-estimator";

const { signTransaction } = vi.hoisted(() => ({
  signTransaction: vi.fn().mockResolvedValue("SIGNED_XDR"),
}));

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: {
      connected: true,
      publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      activeWalletId: "freighter",
      balance: "100.00",
    },
    fetchBalance: vi.fn(),
  }),
}));
vi.mock("@/lib/wallets", () => ({
  getWalletConnector: () => ({ signTransaction }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/contracts", () => ({
  recordPaymentOnChain: vi.fn().mockResolvedValue({ status: "RECORDED", txHash: "onchain" }),
}));
vi.mock("@/hooks/useApiQuery", () => ({
  useApiQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useApiMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: "pay_1" }) }),
}));
vi.mock("@/lib/trustline", () => ({
  checkTrustline: vi.fn().mockResolvedValue({ hasTrustline: true, balance: "100" }),
}));
vi.mock("@/lib/transaction-simulator", () => ({
  simulatePayment: vi.fn().mockResolvedValue({ success: true, fee: "100", operations: 1 }),
}));

const DEST = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

const horizonStats = {
  last_ledger: "1",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.97",
  fee_charged: { mode: "100", p70: "250", p95: "1200" },
};

function horizonUp() {
  vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
    feeStats: vi.fn().mockResolvedValue(horizonStats),
  } as never);
}
function horizonDown() {
  vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue({
    feeStats: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
  } as never);
}

function mockBuild(fee?: string) {
  return vi.spyOn(stellarLib, "buildPaymentTx").mockImplementation(async (p) => ({
    xdr: "BUILT_XDR",
    sourceAccount: {} as unknown as Horizon.AccountResponse,
    fee: fee ?? p.fee ?? "0",
  }));
}

async function fillAndSend() {
  fireEvent.change(screen.getByTestId("destination-input"), { target: { value: DEST } });
  fireEvent.change(screen.getByTestId("amount-input"), { target: { value: "5" } });
  fireEvent.click(screen.getByTestId("send-btn"));
}

describe("SendPage fee recommendation (#825)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    resetFeeCache();
    signTransaction.mockResolvedValue("SIGNED_XDR");
    vi.spyOn(stellarLib, "fetchAllBalances").mockResolvedValue([]);
    vi.spyOn(stellarLib, "accountExists").mockResolvedValue(true);
    vi.spyOn(stellarLib, "submitSignedTx").mockResolvedValue({ hash: "abc", successful: true });
  });

  it("shows the Horizon-based fee and its basis before signing", async () => {
    horizonUp();
    render(<SendPage />);
    expect((await screen.findByTestId("fee-total")).textContent).toContain("0.000025 XLM (250 stroops");
    const basis = screen.getByTestId("fee-basis").textContent ?? "";
    expect(basis).toContain("Normal policy");
    expect(basis).toContain("ledger 97% full");
    expect(basis).toContain("Higher than the 100 stroop base fee");
    expect(screen.queryByTestId("fee-stale-warning")).toBeNull();
  });

  it("submits exactly the fee that was shown", async () => {
    horizonUp();
    const build = mockBuild();
    render(<SendPage />);
    await screen.findByTestId("fee-total");

    await fillAndSend();

    await waitFor(() => expect(signTransaction).toHaveBeenCalled());
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ fee: "250" }));
    expect(signTransaction.mock.calls[0][0]).toBe("BUILT_XDR");
  });

  it("re-quotes and submits the priority fee when the user picks a higher policy", async () => {
    horizonUp();
    const build = mockBuild();
    render(<SendPage />);
    await screen.findByTestId("fee-total");

    fireEvent.change(screen.getByTestId("fee-policy-select"), { target: { value: "high" } });
    await waitFor(() =>
      expect(screen.getByTestId("fee-total").textContent).toContain("0.00012 XLM (1200 stroops")
    );
    expect(screen.getByTestId("fee-basis").textContent).toContain("Priority policy");

    await fillAndSend();
    await waitFor(() => expect(signTransaction).toHaveBeenCalled());
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ fee: "1200" }));
  });

  it("indicates the fallback when Horizon is unreachable and still submits that fee", async () => {
    horizonDown();
    const build = mockBuild();
    render(<SendPage />);

    expect((await screen.findByTestId("fee-stale-warning")).textContent).toContain(
      "Horizon is unreachable"
    );
    expect(screen.getByTestId("fee-total").textContent).toContain("100 stroops");

    await fillAndSend();
    await waitFor(() => expect(signTransaction).toHaveBeenCalled());
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ fee: "100" }));
  });

  it("refuses to sign when the built transaction's fee differs from the fee shown", async () => {
    horizonUp();
    mockBuild("999");
    render(<SendPage />);
    await screen.findByTestId("fee-total");

    await fillAndSend();

    expect(await screen.findByText(/does not match the fee shown/)).toBeTruthy();
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
