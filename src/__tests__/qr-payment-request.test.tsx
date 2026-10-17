// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { QrCode } from "@/components/ui/QrCode";
import { PaymentRequestModal } from "@/components/payments/PaymentRequestModal";
import { buildSep7PayUri, parseSep7PayUri } from "@/lib/stellar-uri";

const ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const toDataURLMock = vi.fn();

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataURLMock(...args),
  },
}));

describe("SEP-0007 URI Parser & Generator (Issue #1375)", () => {
  it("parses valid SEP-0007 web+stellar:pay URI into component parameters", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      amount: "25.5",
      assetCode: "USDC",
      assetIssuer: ISSUER,
      memo: "inv-999",
      memoType: "MEMO_TEXT",
      msg: "Payment for services",
    });

    const parsed = parseSep7PayUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.destination).toBe(ADDRESS);
    expect(parsed?.amount).toBe("25.5");
    expect(parsed?.assetCode).toBe("USDC");
    expect(parsed?.assetIssuer).toBe(ISSUER);
    expect(parsed?.memo).toBe("inv-999");
    expect(parsed?.memoType).toBe("MEMO_TEXT");
    expect(parsed?.msg).toBe("Payment for services");
  });

  it("returns null for non-SEP7 URIs or invalid destinations", () => {
    expect(parseSep7PayUri("https://stellar.org")).toBeNull();
    expect(parseSep7PayUri("web+stellar:pay?destination=invalid_address")).toBeNull();
    expect(parseSep7PayUri("")).toBeNull();
  });
});

describe("QrCode Component Enhancements (Issue #1375)", () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockResolvedValue("data:image/png;base64,FAKE_QR");
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("automatically generates SEP-7 pay URI from shorthand destination and amount props", async () => {
    render(
      <QrCode
        destination={ADDRESS}
        amount="100"
        title="Payment Request QR"
      />
    );

    await screen.findByRole("img", { name: /payment request qr/i });
    expect(toDataURLMock).toHaveBeenCalledWith(
      expect.stringContaining(`web+stellar:pay?destination=${ADDRESS}&amount=100`),
      expect.objectContaining({ width: 220 })
    );
  });

  it("renders download and copy action buttons when showActions is true", async () => {
    render(
      <QrCode
        destination={ADDRESS}
        amount="50"
        showActions
        title="Payment QR"
      />
    );

    await screen.findByRole("img", { name: /payment qr/i });
    expect(screen.getByRole("button", { name: /copy uri/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download qr image/i })).toBeInTheDocument();
  });

  it("triggers clipboard writeText on Copy URI click and displays quick-copy feedback", async () => {
    render(
      <QrCode
        destination={ADDRESS}
        amount="50"
        showActions
      />
    );

    await screen.findByRole("img");
    const copyButton = screen.getByRole("button", { name: /copy uri/i });
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(`destination=${ADDRESS}`)
    );

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("triggers high-resolution download on Download QR click", async () => {
    const appendChildSpy = vi.spyOn(document.body, "appendChild");
    const removeChildSpy = vi.spyOn(document.body, "removeChild");

    render(
      <QrCode
        destination={ADDRESS}
        amount="10"
        showActions
        downloadFileName="my-payment.png"
      />
    );

    await screen.findByRole("img");
    const downloadButton = screen.getByRole("button", { name: /download qr image/i });
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(toDataURLMock).toHaveBeenCalledWith(
        expect.stringContaining(`destination=${ADDRESS}`),
        expect.objectContaining({ width: 1024 })
      );
    });

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });
});

describe("PaymentRequestModal Component (Issue #1375)", () => {
  beforeEach(() => {
    toDataURLMock.mockReset();
    toDataURLMock.mockResolvedValue("data:image/png;base64,FAKE_QR");
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders modal with initial prefilled destination and live SEP-7 URI", async () => {
    const handleClose = vi.fn();
    render(
      <PaymentRequestModal
        open={true}
        onClose={handleClose}
        initialDestination={ADDRESS}
        initialAmount="75.25"
      />
    );

    expect(screen.getByText("Stellar Payment Request")).toBeInTheDocument();
    expect(screen.getByDisplayValue(ADDRESS)).toBeInTheDocument();
    expect(screen.getByDisplayValue("75.25")).toBeInTheDocument();

    // Verify generated URI in the preview text
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`web\\+stellar:pay.*destination=${ADDRESS}`))).toBeInTheDocument();
    });

    // Check QR code image rendered
    expect(await screen.findByRole("img", { name: /sep-0007 payment qr code/i })).toBeInTheDocument();
  });

  it("displays validation warning when destination address is invalid", async () => {
    render(
      <PaymentRequestModal
        open={true}
        onClose={vi.fn()}
        initialDestination="INVALID_ADDRESS"
      />
    );

    expect(screen.getByText(/invalid stellar public key address/i)).toBeInTheDocument();
    expect(screen.getByText(/enter a valid destination address/i)).toBeInTheDocument();
  });

  it("allows user to update amount and memo, updating the generated SEP-7 URI", async () => {
    render(
      <PaymentRequestModal
        open={true}
        onClose={vi.fn()}
        initialDestination={ADDRESS}
      />
    );

    const amountInput = screen.getByPlaceholderText("Any");
    fireEvent.change(amountInput, { target: { value: "300" } });

    const memoInput = screen.getByPlaceholderText("Invoice # or ID");
    fireEvent.change(memoInput, { target: { value: "order-42" } });

    await waitFor(() => {
      const uriText = screen.getByText(new RegExp(`amount=300.*memo=order-42`));
      expect(uriText).toBeInTheDocument();
    });
  });

  it("allows user to click copy payment link in the modal", async () => {
    render(
      <PaymentRequestModal
        open={true}
        onClose={vi.fn()}
        initialDestination={ADDRESS}
        initialAmount="50"
      />
    );

    await screen.findByRole("img", { name: /sep-0007 payment qr code/i });
    const copyLinkBtn = screen.getByRole("button", { name: /copy payment link/i });
    
    await act(async () => {
      fireEvent.click(copyLinkBtn);
    });

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(`web+stellar:pay?destination=${ADDRESS}&amount=50`)
      );
    });
  });
});
