// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  validateSep7Uri,
  isValidSep7Uri,
  parseSep7PayUri,
  buildSep7PayUri,
  buildReceivePayload,
  SUPPORTED_MOBILE_WALLETS,
} from "@/lib/stellar-uri";
import {
  generateSep7PaymentUri,
  parsePaymentLink,
} from "@/lib/payment-link";

const VALID_ADDR_1 = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VALID_ADDR_2 = "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ";
const ISSUER_ADDR = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const INVALID_ADDR = "INVALID_ADDR_NOT_56_CHARS";

describe("SEP-7 URI Scheme - Validation & Grammar", () => {
  it("validates a minimal valid SEP-7 pay URI", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(true);
    expect(result.params?.destination).toBe(VALID_ADDR_1);
    expect(isValidSep7Uri(uri)).toBe(true);
  });

  it("validates a comprehensive SEP-7 pay URI with all valid fields", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&amount=100.5&memo=invoice-123&memo_type=MEMO_TEXT&asset_code=USDC&asset_issuer=${ISSUER_ADDR}&msg=Thank+you`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(true);
    expect(result.params).toEqual({
      destination: VALID_ADDR_1,
      amount: "100.5",
      memo: "invoice-123",
      memoType: "MEMO_TEXT",
      assetCode: "USDC",
      assetIssuer: ISSUER_ADDR,
      msg: "Thank you",
      networkPassphrase: undefined,
      callback: undefined,
    });
  });

  it("rejects empty or whitespace-only URIs", () => {
    expect(validateSep7Uri("").valid).toBe(false);
    expect(validateSep7Uri("   ").valid).toBe(false);
    expect(isValidSep7Uri("")).toBe(false);
  });

  it("rejects URIs without web+stellar:pay? prefix", () => {
    const result = validateSep7Uri(`https://example.com/pay?destination=${VALID_ADDR_1}`);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("web+stellar:pay?");
  });

  it("rejects missing destination parameter", () => {
    const result = validateSep7Uri("web+stellar:pay?amount=10");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing required 'destination'");
  });

  it("rejects invalid destination public key", () => {
    const result = validateSep7Uri(`web+stellar:pay?destination=${INVALID_ADDR}`);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid Stellar destination");
  });

  it("accepts federated destination address", () => {
    const uri = "web+stellar:pay?destination=alice*stellar.org";
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(true);
    expect(result.params?.destination).toBe("alice*stellar.org");
  });

  it("rejects invalid or negative amounts", () => {
    expect(validateSep7Uri(`web+stellar:pay?destination=${VALID_ADDR_1}&amount=-5`).valid).toBe(false);
    expect(validateSep7Uri(`web+stellar:pay?destination=${VALID_ADDR_1}&amount=abc`).valid).toBe(false);
    expect(validateSep7Uri(`web+stellar:pay?destination=${VALID_ADDR_1}&amount=0`).valid).toBe(false);
    expect(validateSep7Uri(`web+stellar:pay?destination=${VALID_ADDR_1}&amount=10.12345678`).valid).toBe(false);
  });

  it("accepts amounts with up to 7 decimal places (Stellar stroop precision)", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&amount=12.3456789`;
    expect(validateSep7Uri(uri).valid).toBe(true);
  });

  it("rejects non-native assets without asset_issuer", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&asset_code=USDC`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("asset_issuer is required");
  });

  it("allows native XLM asset without asset_issuer", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&asset_code=XLM`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(true);
  });

  it("rejects MEMO_TEXT exceeding 28 bytes", () => {
    const longMemo = "a".repeat(29);
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&memo=${longMemo}&memo_type=MEMO_TEXT`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("28 byte limit");
  });

  it("validates MEMO_ID unsigned 64-bit integer", () => {
    const validIdUri = `web+stellar:pay?destination=${VALID_ADDR_1}&memo=123456789&memo_type=MEMO_ID`;
    expect(validateSep7Uri(validIdUri).valid).toBe(true);

    const invalidIdUri = `web+stellar:pay?destination=${VALID_ADDR_1}&memo=notanumber&memo_type=MEMO_ID`;
    expect(validateSep7Uri(invalidIdUri).valid).toBe(false);
  });

  it("rejects invalid memo_type values", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&memo=test&memo_type=INVALID_TYPE`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("memo_type must be");
  });

  it("rejects messages exceeding 300 characters", () => {
    const longMsg = "x".repeat(301);
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&msg=${longMsg}`;
    const result = validateSep7Uri(uri);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("300 characters");
  });
});

describe("buildSep7PayUri & parseSep7PayUri round-trip", () => {
  it("builds a clean SEP-7 pay URI omitting empty fields", () => {
    const uri = buildSep7PayUri({ destination: VALID_ADDR_2 });
    expect(uri).toBe(`web+stellar:pay?destination=${VALID_ADDR_2}`);
  });

  it("omits native XLM asset from query params per SEP-7 specification", () => {
    const uri = buildSep7PayUri({
      destination: VALID_ADDR_1,
      assetCode: "XLM",
    });
    expect(uri).not.toContain("asset_code");
  });

  it("preserves non-native asset details", () => {
    const uri = buildSep7PayUri({
      destination: VALID_ADDR_1,
      assetCode: "USDC",
      assetIssuer: ISSUER_ADDR,
      amount: "50",
    });
    const parsed = parseSep7PayUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.assetCode).toBe("USDC");
    expect(parsed?.assetIssuer).toBe(ISSUER_ADDR);
    expect(parsed?.amount).toBe("50");
  });

  it("maintains round-trip fidelity between build and parse", () => {
    const input = {
      destination: VALID_ADDR_2,
      amount: "99.99",
      memo: "ref-987",
      memoType: "MEMO_TEXT" as const,
      msg: "Payment for order 12",
    };
    const uri = buildSep7PayUri(input);
    const output = parseSep7PayUri(uri);
    expect(output?.destination).toBe(input.destination);
    expect(output?.amount).toBe(input.amount);
    expect(output?.memo).toBe(input.memo);
    expect(output?.memoType).toBe(input.memoType);
    expect(output?.msg).toBe(input.msg);
  });
});

describe("buildReceivePayload helper", () => {
  it("creates a payment request without amount for generic receiving", () => {
    const payload = buildReceivePayload(VALID_ADDR_1);
    expect(payload).toBe(`web+stellar:pay?destination=${VALID_ADDR_1}`);
  });

  it("creates a payment request with prefilled amount and memo", () => {
    const payload = buildReceivePayload(VALID_ADDR_1, {
      amount: "15",
      memo: "Coffee",
    });
    expect(payload).toContain("amount=15");
    expect(payload).toContain("memo=Coffee");
  });
});

describe("Payment link integration with SEP-7", () => {
  it("generates SEP-7 payment URI from payment parameters", () => {
    const sep7 = generateSep7PaymentUri({
      destination: VALID_ADDR_1,
      amount: "42.5",
      memo: "donation",
    });
    expect(sep7.startsWith("web+stellar:pay?")).toBe(true);
    expect(sep7).toContain(`destination=${VALID_ADDR_1}`);
    expect(sep7).toContain("amount=42.5");
    expect(sep7).toContain("memo=donation");
  });

  it("parses SEP-7 URIs accurately in parsePaymentLink", () => {
    const uri = `web+stellar:pay?destination=${VALID_ADDR_1}&amount=20&memo=lunch&asset_code=USDC&asset_issuer=${ISSUER_ADDR}`;
    const parsed = parsePaymentLink(uri);
    expect(parsed).not.toBeNull();
    expect(parsed?.destination).toBe(VALID_ADDR_1);
    expect(parsed?.amount).toBe("20");
    expect(parsed?.memo).toBe("lunch");
    expect(parsed?.assetCode).toBe("USDC");
    expect(parsed?.assetIssuer).toBe(ISSUER_ADDR);
  });
});

describe("Supported Mobile Wallets", () => {
  it("includes top stellar mobile wallets", () => {
    const names = SUPPORTED_MOBILE_WALLETS.map((w) => w.name);
    expect(names).toContain("Lobstr");
    expect(names).toContain("Solar Wallet");
    expect(names).toContain("Beans App");
    expect(names).toContain("Decaf");
    expect(names).toContain("Vibrant");
  });

  it("every wallet has supported platforms and a valid URL", () => {
    for (const wallet of SUPPORTED_MOBILE_WALLETS) {
      expect(wallet.name.length).toBeGreaterThan(0);
      expect(wallet.platform.length).toBeGreaterThan(0);
      expect(wallet.url.startsWith("https://")).toBe(true);
    }
  });
});
