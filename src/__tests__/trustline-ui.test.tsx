// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssetSelector } from "@/components/AssetSelector";
import ReceivePage from "@/app/receive/page";
import { XLM_ASSET, USDC_TESTNET } from "@/lib/assets";
import * as trustlineLib from "@/lib/trustline";
import * as stellarLib from "@/lib/stellar";

const TEST_ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Mock QR code
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR"),
  },
}));

// Mock wallet
let mockWalletState = {
  connected: true,
  publicKey: TEST_ACCOUNT,
  network: "TESTNET",
  balance: "100",
  balanceLoading: false,
  activeWalletId: "freighter",
};

const mockConnect = vi.fn();
vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: mockWalletState,
    connect: mockConnect,
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
    availableWallets: ["freighter"],
  }),
}));

vi.mock("@/lib/wallets", () => ({
  getWalletConnector: () => ({
    getAddress: () => Promise.resolve(TEST_ACCOUNT),
    signTransaction: vi.fn().mockResolvedValue("AAAA_SIGNED_XDR"),
  }),
}));

describe("AssetSelector - Trustline UX", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(stellarLib, "fetchAllBalances").mockResolvedValue([]);
  });

  it("surfaces explanation, reserve requirement, and setup action when selecting an untrusted asset", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: USDC_TESTNET.code,
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: false,
      status: "no_trustline",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "No trustline established.",
      actionRequired: true,
      reserveRequirementXlm: "0.5",
    });

    const onEstablish = vi.fn();
    render(
      <AssetSelector
        publicKey={TEST_ACCOUNT}
        selectedAsset={USDC_TESTNET}
        onSelect={vi.fn()}
        onEstablishTrustline={onEstablish}
      />
    );

    const notice = await screen.findByTestId("trustline-setup-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent("Trustline Required for USDC");
    expect(notice).toHaveTextContent(
      "A trustline is an explicit agreement on the Stellar network that enables your account to receive and hold a specific non-native asset from an issuer."
    );
    expect(notice).toHaveTextContent("Base reserve requirement: 0.5 XLM");

    const setupBtn = screen.getByRole("button", { name: /set up trustline/i });
    expect(setupBtn).toBeInTheDocument();
    fireEvent.click(setupBtn);
    expect(onEstablish).toHaveBeenCalledWith(USDC_TESTNET);
  });

  it("surfaces distinct alert for frozen trustline state", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: USDC_TESTNET.code,
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: true,
      status: "frozen",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "Trustline frozen: The asset issuer has temporarily frozen this trustline for your account.",
      actionRequired: true,
      reserveRequirementXlm: "0.5",
    });

    render(
      <AssetSelector
        publicKey={TEST_ACCOUNT}
        selectedAsset={USDC_TESTNET}
        onSelect={vi.fn()}
      />
    );

    const alert = await screen.findByTestId("trustline-frozen-notice");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Trustline Frozen");
    expect(alert).toHaveTextContent("temporarily frozen this trustline");
  });

  it("surfaces distinct alert for unauthorized trustline state", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: USDC_TESTNET.code,
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: true,
      status: "unauthorized",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "Trustline unauthorized: The asset issuer requires explicit authorization before your account can receive or trade USDC.",
      actionRequired: true,
      reserveRequirementXlm: "0.5",
    });

    render(
      <AssetSelector
        publicKey={TEST_ACCOUNT}
        selectedAsset={USDC_TESTNET}
        onSelect={vi.fn()}
      />
    );

    const alert = await screen.findByTestId("trustline-unauthorized-notice");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Trustline Unauthorized");
    expect(alert).toHaveTextContent("issuer requires explicit authorization");
  });
});

describe("ReceivePage - Trustline Flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockWalletState = {
      connected: true,
      publicKey: TEST_ACCOUNT,
      network: "TESTNET",
      balance: "100",
      balanceLoading: false,
      activeWalletId: "freighter",
    };
    vi.spyOn(stellarLib, "fetchAllBalances").mockResolvedValue([]);
  });

  it("renders default XLM receive instructions without trustline requirement", () => {
    render(<ReceivePage />);
    expect(
      screen.getByText(/Native Stellar Lumens \(XLM\) — accepted by all funded accounts/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(`web+stellar:pay?destination=${TEST_ACCOUNT}`)
    ).toBeInTheDocument();
  });

  it("handles trustline setup flow when switching to USDC without trustline", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: "USDC",
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: false,
      status: "no_trustline",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "No trustline established.",
      actionRequired: true,
      reserveRequirementXlm: "0.5",
    });

    const establishSpy = vi
      .spyOn(trustlineLib, "establishTrustlineWithWallet")
      .mockResolvedValue({ txHash: "tx_abc123", success: true });

    render(<ReceivePage />);

    // Open asset dropdown and pick USDC
    const dropdown = screen.getByRole("button", { name: /xlm/i });
    fireEvent.click(dropdown);

    const usdcOption = screen.getByRole("button", { name: /usdc/i });
    fireEvent.click(usdcOption);

    // Verify explanation and setup banner
    const setupCard = await screen.findByTestId("receive-trustline-setup");
    expect(setupCard).toBeInTheDocument();
    expect(setupCard).toHaveTextContent("Trustline Required to Receive USDC");
    expect(setupCard).toHaveTextContent(
      "A trustline is an explicit agreement on the Stellar network that enables your account to receive and hold a specific non-native asset from an issuer."
    );
    expect(setupCard).toHaveTextContent("Base reserve requirement: 0.5 XLM");

    // Establish trustline
    const actionBtn = screen.getByRole("button", {
      name: /establish trustline for usdc/i,
    });
    fireEvent.click(actionBtn);

    await waitFor(() => {
      expect(establishSpy).toHaveBeenCalledWith({
        walletId: "freighter",
        publicKey: TEST_ACCOUNT,
        assetCode: "USDC",
        assetIssuer: USDC_TESTNET.issuer!,
      });
    });

    // Check success banner appears
    await screen.findByRole("status");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Trustline successfully established on Stellar for USDC"
    );
  });

  it("shows distinct frozen warning when receiving an asset with frozen trustline", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: "USDC",
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: true,
      status: "frozen",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "Trustline frozen: The asset issuer has temporarily frozen this trustline for your account.",
      actionRequired: true,
      reserveRequirementXlm: "0.5",
    });

    render(<ReceivePage />);

    const dropdown = screen.getByRole("button", { name: /xlm/i });
    fireEvent.click(dropdown);
    const usdcOption = screen.getByRole("button", { name: /usdc/i });
    fireEvent.click(usdcOption);

    const frozenAlert = await screen.findByTestId("receive-trustline-frozen");
    expect(frozenAlert).toBeInTheDocument();
    expect(frozenAlert).toHaveTextContent("Trustline Frozen");
    expect(frozenAlert).toHaveTextContent("temporarily frozen this trustline");
  });

  it("shows distinct unauthorized warning when receiving an unauthorized asset", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: "USDC",
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: true,
      status: "unauthorized",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "Trustline unauthorized: The asset issuer requires explicit authorization before your account can receive or trade USDC.",
      actionRequired: true,
      reserveRequirementXlm: "0.5",
    });

    render(<ReceivePage />);

    const dropdown = screen.getByRole("button", { name: /xlm/i });
    fireEvent.click(dropdown);
    const usdcOption = screen.getByRole("button", { name: /usdc/i });
    fireEvent.click(usdcOption);

    const unauthAlert = await screen.findByTestId("receive-trustline-unauthorized");
    expect(unauthAlert).toBeInTheDocument();
    expect(unauthAlert).toHaveTextContent("Trustline Unauthorized");
    expect(unauthAlert).toHaveTextContent("issuer requires explicit authorization");
  });

  it("updates SEP-7 payload with asset code and issuer when trustline is authorized", async () => {
    vi.spyOn(trustlineLib, "checkTrustline").mockResolvedValue({
      assetCode: "USDC",
      assetIssuer: USDC_TESTNET.issuer!,
      hasTrustline: true,
      status: "authorized",
      balance: "50.00",
      explanation: trustlineLib.TRUSTLINE_ONE_SENTENCE_EXPLANATION,
      message: "Trustline active and authorized.",
      actionRequired: false,
      reserveRequirementXlm: "0.5",
    });

    render(<ReceivePage />);

    const dropdown = screen.getByRole("button", { name: /xlm/i });
    fireEvent.click(dropdown);
    const usdcOption = screen.getByRole("button", { name: /usdc/i });
    fireEvent.click(usdcOption);

    const activeNotice = await screen.findByTestId("receive-trustline-authorized");
    expect(activeNotice).toHaveTextContent("Trustline Active & Authorized");
    expect(activeNotice).toHaveTextContent("Balance: 50.00 USDC");

    // SEP-7 URI includes asset code & issuer
    const expectedUri = `web+stellar:pay?destination=${TEST_ACCOUNT}&asset_code=USDC&asset_issuer=${USDC_TESTNET.issuer}`;
    expect(screen.getByText(expectedUri)).toBeInTheDocument();
  });
});
