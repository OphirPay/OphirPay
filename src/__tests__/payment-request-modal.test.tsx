// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const toDataURLMock = vi.fn();

vi.mock("qrcode", () => ({
  default: {
    toDataURL: (...args: unknown[]) => toDataURLMock(...args),
  },
}));

import { PaymentRequestModal } from "@/components/payments/PaymentRequestModal";

const ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

beforeEach(() => {
  toDataURLMock.mockReset();
  toDataURLMock.mockResolvedValue("data:image/png;base64,AAAA");
});

describe("PaymentRequestModal (issue #1375)", () => {
  it("encodes a scan-ready SEP-7 URI with amount, asset and memo", async () => {
    render(
      <PaymentRequestModal
        open
        onClose={vi.fn()}
        request={{
          id: "req_1",
          destination: ADDRESS,
          amount: "12.5",
          assetCode: "USDC",
          assetIssuer: ISSUER,
          memo: "invoice-42",
          description: "Invoice 42",
        }}
      />
    );

    const code = await screen.findByText(/web\+stellar:pay\?/);
    const uri = code.textContent ?? "";
    expect(uri).toContain(`destination=${ADDRESS}`);
    expect(uri).toContain("amount=12.5");
    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${ISSUER}`);
    expect(uri).toContain("memo=invoice-42");
    expect(uri).toContain("msg=Invoice+42");

    // The QR payload is the URI itself, not an https redirect.
    expect(toDataURLMock).toHaveBeenCalledWith(
      expect.stringMatching(/^web\+stellar:pay\?/),
      expect.objectContaining({ width: 240 })
    );
  });

  it("omits the asset for native XLM payments", async () => {
    render(
      <PaymentRequestModal
        open
        onClose={vi.fn()}
        request={{ destination: ADDRESS, amount: "1", assetCode: "XLM" }}
      />
    );

    const uri = (await screen.findByText(/web\+stellar:pay\?/)).textContent ?? "";
    expect(uri).not.toContain("asset_code");
    expect(uri).not.toContain("asset_issuer");
  });

  it("warns when a custom asset has no issuer", async () => {
    render(
      <PaymentRequestModal
        open
        onClose={vi.fn()}
        request={{ destination: ADDRESS, amount: "1", assetCode: "USDC" }}
      />
    );

    expect(await screen.findByRole("status")).toHaveTextContent(/issuer/i);
  });

  it("explains why an invalid destination cannot produce a QR", () => {
    render(
      <PaymentRequestModal
        open
        onClose={vi.fn()}
        request={{ destination: "not-an-address", amount: "1" }}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/valid Stellar recipient/i);
    expect(screen.queryByRole("img", { name: /payment qr/i })).toBeNull();
  });

  it("shows the browser share link next to the wallet QR", async () => {
    render(
      <PaymentRequestModal
        open
        onClose={vi.fn()}
        request={{ destination: ADDRESS, amount: "1" }}
        paymentLink="https://ophirpay.example/pay/GABC?amount=1"
      />
    );

    expect(
      await screen.findByText("https://ophirpay.example/pay/GABC?amount=1")
    ).toBeInTheDocument();
  });
});
