// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  buildReceivePayload,
  buildSep7PayUri,
  buildSep7DeepLink,
  isValidSep7Uri,
  parseSep7Destination,
} from "@/lib/stellar-uri";

const ADDRESS = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF";

describe("buildSep7PayUri", () => {
  it("builds a web+stellar:pay URI with destination", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("encodes special characters in destination", () => {
    const uri = buildSep7PayUri({ destination: "G A&B" });
    expect(uri).toBe("web+stellar:pay?destination=G+A%26B");
  });

  it("includes amount when provided", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, amount: "12.5" });
    expect(uri).toContain("amount=12.5");
  });

  it("omits amount when empty", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, amount: "" });
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("includes memo and memo_type", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      memo: "invoice-42",
      memoType: "MEMO_TEXT",
    });
    expect(uri).toContain("memo=invoice-42");
    expect(uri).toContain("memo_type=MEMO_TEXT");
  });

  it("omits memo_type when no memo given", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, memoType: "MEMO_TEXT" });
    expect(uri).not.toContain("memo_type");
  });

  it("encodes non-native asset with issuer", () => {
    const issuer = "GAIUEOOO3B4KX3Q4XWQPQK3G2Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z3Z";
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      assetCode: "USDC",
      assetIssuer: issuer,
    });
    expect(uri).toContain("asset_code=USDC");
    expect(uri).toContain(`asset_issuer=${issuer}`);
  });

  it("omits asset for native XLM", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, assetCode: "XLM" });
    expect(uri).not.toContain("asset_code");
    expect(uri).toBe(`web+stellar:pay?destination=${ADDRESS}`);
  });

  it("includes human-readable message", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, msg: "Thanks!" });
    expect(uri).toContain("msg=Thanks%21");
  });
});

describe("buildSep7DeepLink", () => {
  it("builds a stellar: URI with destination", () => {
    const uri = buildSep7DeepLink({ destination: ADDRESS });
    expect(uri).toBe(`stellar:pay?destination=${ADDRESS}`);
    expect(uri.startsWith("stellar:pay")).toBe(true);
  });

  it("uses stellar: scheme instead of web+stellar:", () => {
    const webUri = buildSep7PayUri({ destination: ADDRESS });
    const deepUri = buildSep7DeepLink({ destination: ADDRESS });
    expect(webUri).toContain("web+stellar:");
    expect(deepUri).toContain("stellar:");
    expect(webUri).not.toBe(deepUri);
  });

  it("carries same params as web+stellar:", () => {
    const params = {
      destination: ADDRESS,
      amount: "100",
      memo: "test",
      assetCode: "USD",
      msg: "hello",
    };
    const webUri = buildSep7PayUri(params);
    const deepUri = buildSep7DeepLink(params);
    const webParams = new URL(webUri).searchParams;
    const deepParams = new URL(deepUri).searchParams;
    expect(webParams.get("destination")).toBe(deepParams.get("destination"));
    expect(webParams.get("amount")).toBe(deepParams.get("amount"));
    expect(webParams.get("memo")).toBe(deepParams.get("memo"));
  });

  it("omits asset for native XLM", () => {
    const uri = buildSep7DeepLink({ destination: ADDRESS, assetCode: "XLM" });
    expect(uri).not.toContain("asset_code");
  });
});

describe("isValidSep7Uri", () => {
  it("accepts valid web+stellar: URIs", () => {
    expect(isValidSep7Uri(buildSep7PayUri({ destination: ADDRESS }))).toBe(true);
  });

  it("accepts valid stellar: URIs", () => {
    expect(isValidSep7Uri(buildSep7DeepLink({ destination: ADDRESS }))).toBe(true);
  });

  it("rejects invalid destination", () => {
    expect(isValidSep7Uri("web+stellar:pay?destination=invalid")).toBe(false);
  });

  it("rejects wrong scheme", () => {
    expect(isValidSep7Uri("https://example.com/pay?destination=G...")).toBe(false);
  });

  it("rejects malformed URIs", () => {
    expect(isValidSep7Uri("not-a-uri")).toBe(false);
    expect(isValidSep7Uri("")).toBe(false);
  });
});

describe("parseSep7Destination", () => {
  it("extracts from web+stellar: URI", () => {
    const uri = buildSep7PayUri({ destination: ADDRESS, amount: "50" });
    expect(parseSep7Destination(uri)).toBe(ADDRESS);
  });

  it("extracts from stellar: URI", () => {
    const uri = buildSep7DeepLink({ destination: ADDRESS });
    expect(parseSep7Destination(uri)).toBe(ADDRESS);
  });

  it("returns null for invalid URIs", () => {
    expect(parseSep7Destination("invalid")).toBeNull();
    expect(parseSep7Destination("")).toBeNull();
  });
});

describe("buildReceivePayload", () => {
  it("encodes just the address for receive", () => {
    expect(buildReceivePayload(ADDRESS)).toBe(
      `web+stellar:pay?destination=${ADDRESS}`
    );
  });

  it("handles addresses with special characters", () => {
    const uri = buildReceivePayload("GABC 123");
    expect(uri).toBe("web+stellar:pay?destination=GABC+123");
  });
});
