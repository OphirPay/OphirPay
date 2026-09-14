// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import ReceivePage from "@/app/receive/page";

const ADDRESS_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDRESS_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const toDataURLMock = vi.fn();

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataURLMock(...args),
  },
}));

const getWalletConnectorMock = vi.fn();

vi.mock("@/lib/wallets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallets")>();
  return {
    ...actual,
    getWalletConnector: () => getWalletConnectorMock(),
  };
});

let walletState: {
  connected: boolean;
  publicKey: string | null;
  network: string | null;
  balance: string | null;
  balanceLoading: boolean;
  activeWalletId: string | null;
};

const connectMock = vi.fn();

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: walletState,
    connect: connectMock,
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
    availableWallets: ["freighter", "albedo"],
  }),
}));

function setWallet(publicKey: string | null) {
  walletState = {
    connected: Boolean(publicKey),
    publicKey,
    network: "TESTNET",
    balance: "100",
    balanceLoading: false,
    activeWalletId: publicKey ? "freighter" : null,
  };
}

beforeEach(() => {
  setWallet(null);
  connectMock.mockReset();
  toDataURLMock.mockReset();
  toDataURLMock.mockResolvedValue("data:image/png;base64,QR");
  // Default: the wallet reports the same account the session knows about.
  getWalletConnectorMock.mockReset();
  getWalletConnectorMock.mockReturnValue({
    getAddress: () => Promise.resolve(null),
  });
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("ReceivePage", () => {
  it("prompts to connect a wallet when none is connected", () => {
    render(<ReceivePage />);
    expect(
      screen.getByText("Connect your wallet to receive")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /connect wallet/i })
    ).toBeInTheDocument();
  });

  it("opens the wallet selector from the connect prompt", () => {
    render(<ReceivePage />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    // The wallet selector mounts as an overlay with its own heading
    expect(screen.getByText("Choose your Stellar wallet")).toBeInTheDocument();
    expect(screen.getByText("Find a wallet →")).toBeInTheDocument();
  });

  it("renders the address, SEP-7 URI, and QR when connected", async () => {
    setWallet(ADDRESS_A);
    render(<ReceivePage />);

    // Full address + shortened + SEP-7 URI
    expect(screen.getByText(ADDRESS_A)).toBeInTheDocument();
    expect(screen.getByText("GAAAAAAAA...AAAAAAAA")).toBeInTheDocument();
    expect(
      screen.getByText(`web+stellar:pay?destination=${ADDRESS_A}`)
    ).toBeInTheDocument();

    // QR renders with the SEP-7 payload
    const img = await screen.findByRole("img", { name: /receive qr code/i });
    expect(img).toHaveAttribute("src", "data:image/png;base64,QR");
    expect(toDataURLMock).toHaveBeenCalledWith(
      `web+stellar:pay?destination=${ADDRESS_A}`,
      expect.any(Object)
    );
  });

  it("regenerates the QR when the account changes", async () => {
    setWallet(ADDRESS_A);
    const { rerender } = render(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    setWallet(ADDRESS_B);
    rerender(<ReceivePage />);

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith(
        `web+stellar:pay?destination=${ADDRESS_B}`,
        expect.any(Object)
      )
    );
    expect(
      screen.getByText(`web+stellar:pay?destination=${ADDRESS_B}`)
    ).toBeInTheDocument();
  });

  it("copies the address with the copy button", async () => {
    setWallet(ADDRESS_A);
    render(<ReceivePage />);

    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDRESS_A)
    );
  });

  it("links the address to the Stellar account explorer", () => {
    setWallet(ADDRESS_A);
    render(<ReceivePage />);

    const link = screen.getByRole("link", { name: /view on explorer/i });
    expect(link).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/account/" + ADDRESS_A
    );
  });

  it("warns when the wallet account changed while the page is open", async () => {
    setWallet(ADDRESS_A);
    // The wallet extension is now on a different account than the session.
    getWalletConnectorMock.mockReturnValue({
      getAddress: () => Promise.resolve(ADDRESS_B),
    });

    render(<ReceivePage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Wallet account changed");
    expect(alert).toHaveTextContent(/still targets your previous account/i);
    expect(
      screen.getByRole("button", { name: /reconnect/i })
    ).toBeInTheDocument();
  });

  it("does not warn when the wallet account matches the session", async () => {
    setWallet(ADDRESS_A);
    getWalletConnectorMock.mockReturnValue({
      getAddress: () => Promise.resolve(ADDRESS_A),
    });

    render(<ReceivePage />);

    // Wait for the connected state to render, then assert no warning.
    await screen.findByRole("img", { name: /receive qr code/i });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reconnects from the mismatch warning and clears it", async () => {
    setWallet(ADDRESS_A);
    getWalletConnectorMock.mockReturnValue({
      getAddress: () => Promise.resolve(ADDRESS_B),
    });
    const { rerender } = render(<ReceivePage />);

    const reconnect = await screen.findByRole("button", { name: /reconnect/i });
    fireEvent.click(reconnect);
    expect(connectMock).toHaveBeenCalledWith("freighter");

    // After reconnect the session updates to the live account.
    setWallet(ADDRESS_B);
    getWalletConnectorMock.mockReturnValue({
      getAddress: () => Promise.resolve(ADDRESS_B),
    });
    rerender(<ReceivePage />);

    // The live-account check is async — wait for the warning to clear.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
