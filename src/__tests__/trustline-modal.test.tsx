// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { createTrustline } = vi.hoisted(() => ({ createTrustline: vi.fn() }));

vi.mock("@/lib/stellar-transactions", () => ({ createTrustline }));

import { TrustlineModal, TRUSTLINE_RESERVE_XLM } from "@/components/wallet/TrustlineModal";
import { USDC_TESTNET, type AssetInfo } from "@/lib/assets";

const PUBLIC_KEY = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

function renderModal(overrides: {
  publicKey?: string | null;
  asset?: AssetInfo | null;
  onClose?: () => void;
  onCreated?: (asset: AssetInfo, info: unknown) => void;
} = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    publicKey: PUBLIC_KEY,
    asset: USDC_TESTNET,
    ...overrides,
  };
  return render(<TrustlineModal {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  createTrustline.mockResolvedValue({
    assetCode: "USDC",
    assetIssuer: USDC_TESTNET.issuer,
    hasTrustline: true,
    state: "authorized",
  });
});

describe("TrustlineModal (issue #1384)", () => {
  it("renders nothing when there is no asset to trust", () => {
    const { container } = renderModal({ asset: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("names the dialog after the asset and discloses the reserve cost", () => {
    renderModal();

    expect(
      screen.getByRole("dialog", { name: "Create USDC trustline" }),
    ).toBeDefined();
    expect(screen.getByText(`+${TRUSTLINE_RESERVE_XLM} XLM reserve`)).toBeDefined();
    expect(TRUSTLINE_RESERVE_XLM).toBe("0.5");
  });

  it("creates the trustline in one click and refreshes the caller", async () => {
    const onCreated = vi.fn();
    renderModal({ onCreated });

    fireEvent.click(screen.getByRole("button", { name: "Create trustline" }));

    await waitFor(() =>
      expect(createTrustline).toHaveBeenCalledWith(
        PUBLIC_KEY,
        USDC_TESTNET.code,
        USDC_TESTNET.issuer,
      ),
    );
    // The verified info is handed back so the caller does not re-query Horizon.
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        USDC_TESTNET,
        expect.objectContaining({ state: "authorized" }),
      ),
    );
    expect(
      await screen.findByText(/is now trusted — you can receive it/i),
    ).toBeDefined();
  });

  it("surfaces a wallet rejection as an alert and stays open", async () => {
    createTrustline.mockRejectedValue(new Error("User declined"));
    const onCreated = vi.fn();
    renderModal({ onCreated });

    fireEvent.click(screen.getByRole("button", { name: "Create trustline" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("User declined");
    expect(onCreated).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Create USDC trustline" }),
    ).toBeDefined();
  });

  it("warns when the trustline is created but the issuer has not authorized it", async () => {
    createTrustline.mockResolvedValue({
      assetCode: "USDC",
      assetIssuer: USDC_TESTNET.issuer,
      hasTrustline: true,
      state: "unauthorized",
    });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Create trustline" }));

    // Match the copy, not `role="status"`: the button spinner is also a live
    // region while the request is in flight.
    expect(
      await screen.findByText(/issuer has not authorized/i),
    ).toBeDefined();
    // Not a success state: the dialog keeps Create/Cancel available.
    expect(screen.getByRole("button", { name: "Create trustline" })).toBeDefined();
  });

  it("disables creation until a wallet is connected", () => {
    renderModal({ publicKey: null });
    expect(screen.getByRole("button", { name: "Create trustline" })).toBeDisabled();
  });

  it("closes through the Cancel control", () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
