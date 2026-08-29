// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  generateSep7PayUri,
  parseSep7PayUri,
  generateQrMatrix,
  generateQrSvg,
  type Sep7PayUriOptions,
} from "@/lib/qr";

const VALID_ADDRESS_1 = "GA2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6XG2W6X";
const VALID_ADDRESS_2 = "GB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB3W6XGB";
const VALID_ISSUER = "GDQWI6TUW5JY4HBP57K5N734Q3K367S6C7K254GYEETW2G5KWWV2GY27";

describe("SEP-0007 Pay URI generation & parsing", () => {
  it("generates a basic SEP-7 pay URI with destination only", () => {
    const uri = generateSep7PayUri({ destination: VALID_ADDRESS_1 });
    expect(uri).toBe(`web+stellar:pay?destination=${VALID_ADDRESS_1}`);

    const parsed = parseSep7PayUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.destination).toBe(VALID_ADDRESS_1);
    expect(parsed?.amount).toBeUndefined();
  });

  it("generates a SEP-7 pay URI with amount and memo", () => {
    const uri = generateSep7PayUri({
      destination: VALID_ADDRESS_1,
      amount: "100.50",
      memo: "invoice-101",
      memoType: "MEMO_TEXT",
    });

    expect(uri).toContain(`destination=${VALID_ADDRESS_1}`);
    expect(uri).toContain("amount=100.50");
    expect(uri).toContain("memo=invoice-101");
    expect(uri).toContain("memo_type=MEMO_TEXT");

    const parsed = parseSep7PayUri(uri);
    expect(parsed).toEqual({
      destination: VALID_ADDRESS_1,
      amount: "100.50",
      memo: "invoice-101",
      memoType: "MEMO_TEXT",
    });
  });

  it("generates a SEP-7 pay URI with custom asset and issuer", () => {
    const uri = generateSep7PayUri({
      destination: VALID_ADDRESS_1,
      amount: "50",
      assetCode: "USDC",
      assetIssuer: VALID_ISSUER,
      msg: "Payment for order #99",
    });

    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${VALID_ISSUER}`);
    expect(uri).toContain("msg=Payment+for+order+%2399");

    const parsed = parseSep7PayUri(uri);
    expect(parsed?.destination).toBe(VALID_ADDRESS_1);
    expect(parsed?.amount).toBe("50");
    expect(parsed?.assetCode).toBe("USDC");
    expect(parsed?.assetIssuer).toBe(VALID_ISSUER);
    expect(parsed?.msg).toBe("Payment for order #99");
  });

  it("does not include asset_code when asset is XLM or native", () => {
    const uriXlm = generateSep7PayUri({
      destination: VALID_ADDRESS_1,
      assetCode: "XLM",
    });
    expect(uriXlm).not.toContain("asset_code");

    const uriNative = generateSep7PayUri({
      destination: VALID_ADDRESS_1,
      assetCode: "native",
    });
    expect(uriNative).not.toContain("asset_code");
  });

  it("supports callback, network passphrase, and origin domain", () => {
    const uri = generateSep7PayUri({
      destination: VALID_ADDRESS_1,
      callback: "url:https://api.ophirpay.com/pay-callback",
      networkPassphrase: "Test SDF Network ; September 2015",
      originDomain: "ophirpay.vercel.app",
    });

    expect(uri).toContain("callback=url%3Ahttps%3A%2F%2Fapi.ophirpay.com%2Fpay-callback");
    expect(uri).toContain("network_passphrase=Test+SDF+Network+%3B+September+2015");
    expect(uri).toContain("origin_domain=ophirpay.vercel.app");

    const parsed = parseSep7PayUri(uri);
    expect(parsed?.callback).toBe("url:https://api.ophirpay.com/pay-callback");
    expect(parsed?.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(parsed?.originDomain).toBe("ophirpay.vercel.app");
  });

  it("throws when destination address is missing or invalid", () => {
    expect(() => generateSep7PayUri({ destination: "" })).toThrow("Destination address is required");
    expect(() => generateSep7PayUri({ destination: "invalid-addr" })).toThrow("Invalid Stellar destination address");
  });

  it("parses stellar:pay prefix as well as web+stellar:pay", () => {
    const uri = `stellar:pay?destination=${VALID_ADDRESS_2}&amount=25`;
    const parsed = parseSep7PayUri(uri);
    expect(parsed?.destination).toBe(VALID_ADDRESS_2);
    expect(parsed?.amount).toBe("25");
  });

  it("returns null for malformed or non-stellar pay URIs", () => {
    expect(parseSep7PayUri("")).toBeNull();
    expect(parseSep7PayUri("https://example.com")).toBeNull();
    expect(parseSep7PayUri("web+stellar:pay?no_destination=123")).toBeNull();
    expect(parseSep7PayUri("web+stellar:pay?destination=invalid")).toBeNull();
  });
});

describe("QR Code Matrix & SVG Generation", () => {
  it("generates a boolean matrix with valid dimensions", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDRESS_1}`;
    const matrix = generateQrMatrix(uri, "M");
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0].length).toBe(matrix.length);

    // Check finder pattern presence in top-left (7x7 pattern with dark corners)
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[6][0]).toBe(true);
    expect(matrix[6][6]).toBe(true);
    expect(matrix[1][1]).toBe(false); // inner ring is white
  });

  it("generates valid SVG output with configured size and colors", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDRESS_1}`;
    const svg = generateQrSvg(uri, {
      size: 300,
      margin: 4,
      fgColor: "#0f172a",
      bgColor: "#ffffff",
      title: "Receive XLM",
    });

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="300"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#0f172a"');
    expect(svg).toContain("<title>Receive XLM</title>");
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Receive XLM"');
    expect(svg).toContain("<path d=");
  });

  it("regenerates different matrix/SVG when payload changes", () => {
    const uri1 = generateSep7PayUri({ destination: VALID_ADDRESS_1 });
    const uri2 = generateSep7PayUri({ destination: VALID_ADDRESS_2 });
    const uri3 = generateSep7PayUri({ destination: VALID_ADDRESS_1, amount: "500" });

    const svg1 = generateQrSvg(uri1);
    const svg2 = generateQrSvg(uri2);
    const svg3 = generateQrSvg(uri3);

    expect(svg1).not.toBe(svg2);
    expect(svg1).not.toBe(svg3);
    expect(svg2).not.toBe(svg3);
  });
});
