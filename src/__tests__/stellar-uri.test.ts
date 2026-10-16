// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  generateSep7PayUri,
  parseSep7PayUri,
  type Sep7PayParams,
} from "@/lib/stellar-uri";

describe("SEP-0007 Payment URI Generator & Parser", () => {
  const testAddress = "GABCD5678WXYZ1234GABCD5678WXYZ1234GABCD5678WXYZ1234GABCD5678";
  const issuerAddress = "GBBCC5678WXYZ1234GBBCC5678WXYZ1234GBBCC5678WXYZ1234GBBCC5678";

  it("generates a minimal valid SEP-0007 pay URI", () => {
    const uri = generateSep7PayUri({ destination: testAddress });
    expect(uri).toBe(`web+stellar:pay?destination=${testAddress}`);

    const parsed = parseSep7PayUri(uri);
    expect(parsed).toEqual({ destination: testAddress });
  });

  it("includes amount for native XLM without adding asset_code", () => {
    const uri = generateSep7PayUri({
      destination: testAddress,
      amount: "15.75",
      assetCode: "XLM",
    });
    expect(uri).toBe(`web+stellar:pay?destination=${testAddress}&amount=15.75`);

    const parsed = parseSep7PayUri(uri);
    expect(parsed?.amount).toBe("15.75");
    expect(parsed?.assetCode).toBeUndefined();
  });

  it("includes asset_code and asset_issuer for non-native assets", () => {
    const params: Sep7PayParams = {
      destination: testAddress,
      amount: 100,
      assetCode: "USDC",
      assetIssuer: issuerAddress,
    };
    const uri = generateSep7PayUri(params);
    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${issuerAddress}`);
    expect(uri).toContain("amount=100");

    const parsed = parseSep7PayUri(uri);
    expect(parsed?.assetCode).toBe("USDC");
    expect(parsed?.assetIssuer).toBe(issuerAddress);
    expect(parsed?.amount).toBe("100");
  });

  it("handles memo and memo_type properly", () => {
    const uri = generateSep7PayUri({
      destination: testAddress,
      memo: "INV-1234",
      memoType: "MEMO_TEXT",
    });
    expect(uri).toContain("memo=INV-1234");
    expect(uri).toContain("memo_type=MEMO_TEXT");

    const parsed = parseSep7PayUri(uri);
    expect(parsed?.memo).toBe("INV-1234");
    expect(parsed?.memoType).toBe("MEMO_TEXT");
  });

  it("handles user message, network_passphrase, and origin_domain", () => {
    const uri = generateSep7PayUri({
      destination: testAddress,
      amount: "25",
      msg: "Payment for order #99",
      originDomain: "ophirpay.com",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(uri).toContain("msg=Payment%20for%20order%20%2399");
    expect(uri).toContain("origin_domain=ophirpay.com");
    expect(uri).toContain("network_passphrase=Test%20SDF%20Network%20%3B%20September%202015");

    const parsed = parseSep7PayUri(uri);
    expect(parsed?.msg).toBe("Payment for order #99");
    expect(parsed?.originDomain).toBe("ophirpay.com");
    expect(parsed?.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("throws an error when destination is missing", () => {
    expect(() => generateSep7PayUri({ destination: "" })).toThrow(
      "Destination address is required"
    );
  });

  it("returns null when parsing invalid or non-SEP-0007 URIs", () => {
    expect(parseSep7PayUri("https://example.com")).toBeNull();
    expect(parseSep7PayUri("web+stellar:tx?xdr=abc")).toBeNull();
    expect(parseSep7PayUri("web+stellar:pay?amount=10")).toBeNull();
    expect(parseSep7PayUri("")).toBeNull();
  });
});
