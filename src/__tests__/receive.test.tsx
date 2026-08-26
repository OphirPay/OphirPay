import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildSep7PayUri, generateQrDataUri } from "@/lib/qr";
import ReceivePage from "@/app/receive/page";

// Mock useWallet
let mockWallet = {
  connected: false,
  publicKey: null as string | null,
  network: null as string | null,
  balance: null as string | null,
  balanceLoading: false,
  activeWalletId: null,
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

describe("SEP-0007 QR Utilities", () => {
  it("builds a minimal SEP-7 URI with destination", () => {
    const uri = buildSep7PayUri({ destination: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" });
    expect(uri).toBe("web+stellar:pay?destination=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  });

  it("builds a SEP-7 URI with amount, memo, and memoType", () => {
    const uri = buildSep7PayUri({
      destination: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      amount: "100.5",
      memo: "Invoice 123",
      memoType: "MEMO_TEXT",
    });
    expect(uri).toBe(
      "web+stellar:pay?destination=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&amount=100.5&memo=Invoice%20123&memo_type=MEMO_TEXT"
    );
  });

  it("returns empty string when destination is absent", () => {
    const uri = buildSep7PayUri({ destination: "" });
    expect(uri).toBe("");
  });

  it("generates a valid QR data URL", () => {
    const qr = generateQrDataUri("web+stellar:pay?destination=GABC");
    expect(qr).toContain("api.qrserver.com");
    expect(qr).toContain("web%2Bstellar%3Apay%3Fdestination%3DGABC");
  });
});

describe("ReceivePage Component", () => {
  it("renders disconnected state when wallet is not connected", () => {
    mockWallet.connected = false;
    mockWallet.publicKey = null;

    render(<ReceivePage />);
    expect(screen.getByText(/No Wallet Connected/i)).toBeInTheDocument();
  });

  it("renders QR code and public key when wallet is connected", () => {
    mockWallet.connected = true;
    mockWallet.publicKey = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    render(<ReceivePage />);
    expect(screen.getByText("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN")).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("updates SEP-7 URI when amount is typed", () => {
    mockWallet.connected = true;
    mockWallet.publicKey = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    render(<ReceivePage />);
    const amountInput = screen.getByLabelText(/Requested Amount/i);
    fireEvent.change(amountInput, { target: { value: "50" } });

    expect(screen.getByText(/amount=50/)).toBeInTheDocument();
  });
});
