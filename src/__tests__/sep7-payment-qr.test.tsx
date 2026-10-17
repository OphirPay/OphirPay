// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildSep7PayUri, parseSep7PayUri } from "@/lib/stellar-uri";
import { PaymentRequestModal } from "@/components/payments/PaymentRequestModal";

const DEST = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("SEP-0007 QR Code Payment Request Generator (#1375)", () => {
  it("builds and round-trip parses SEP-0007 web+stellar:pay URIs with amount, asset_code, asset_issuer, memo, and memo_type", () => {
    const uri = buildSep7PayUri({
      destination: DEST,
      amount: "150.25",
      asset_code: "USDC",
      asset_issuer: USDC_ISSUER,
      memo: "987654",
      memo_type: "MEMO_ID",
    });

    expect(uri).toContain(`web+stellar:pay?destination=${DEST}`);
    expect(uri).toContain("amount=150.25");
    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${USDC_ISSUER}`);
    expect(uri).toContain("memo=987654");
    expect(uri).toContain("memo_type=MEMO_ID");

    const parsed = parseSep7PayUri(uri);
    expect(parsed).toEqual({
      destination: DEST,
      amount: "150.25",
      assetCode: "USDC",
      assetIssuer: USDC_ISSUER,
      memo: "987654",
      memoType: "MEMO_ID",
      msg: undefined,
    });
  });

  it("renders PaymentRequestModal with live SEP-0007 URI updates, Copy URI feedback, and Download QR Image", async () => {
    const onClose = vi.fn();
    render(
      <PaymentRequestModal
        open
        onClose={onClose}
        defaultDestination={DEST}
        defaultAmount="50"
      />
    );

    const preview = screen.getByTestId("sep7-uri-preview");
    expect(preview).toHaveTextContent(
      `web+stellar:pay?destination=${DEST}&amount=50`
    );

    // Switch asset to USDC and set a memo
    fireEvent.change(screen.getByTestId("qr-asset-select"), {
      target: { value: "USDC" },
    });
    fireEvent.change(screen.getByTestId("qr-memo-input"), {
      target: { value: "inv-2026" },
    });

    expect(preview).toHaveTextContent("asset_code=USDC");
    expect(preview).toHaveTextContent(`asset_issuer=${USDC_ISSUER}`);
    expect(preview).toHaveTextContent("memo=inv-2026");
    expect(preview).toHaveTextContent("memo_type=MEMO_TEXT");

    // Copy URI button shows "Copied!" feedback
    const copyBtn = screen.getByTestId("copy-sep7-uri-btn");
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(copyBtn).toHaveTextContent("Copied!");
    });

    // Download QR Image button triggers anchor download
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("download-qr-btn"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
