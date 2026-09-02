// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  generatePaymentLink,
  parsePaymentLink,
} from "@/lib/payment-link";

const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INVALID_ADDRESS = "not-a-stellar-address";

describe("generatePaymentLink", () => {
  it("encodes the recipient address in the /pay route", () => {
    const link = generatePaymentLink({ destination: VALID_ADDRESS });
    expect(link).toContain(`/pay/${VALID_ADDRESS}`);
  });

  it("includes optional amount, memo, and asset query params", () => {
    const link = generatePaymentLink({
      destination: VALID_ADDRESS,
      amount: "10.5",
      memo: "invoice-42",
      assetCode: "USDC",
    });
    const url = new URL(link);
    expect(url.pathname).toBe(`/pay/${VALID_ADDRESS}`);
    expect(url.searchParams.get("amount")).toBe("10.5");
    expect(url.searchParams.get("memo")).toBe("invoice-42");
    expect(url.searchParams.get("asset")).toBe("USDC");
  });

  it("omits optional params when not provided", () => {
    const link = generatePaymentLink({ destination: VALID_ADDRESS });
    const url = new URL(link);
    expect(url.searchParams.has("amount")).toBe(false);
    expect(url.searchParams.has("memo")).toBe(false);
    expect(url.searchParams.has("asset")).toBe(false);
  });
});

describe("parsePaymentLink", () => {
  it("parses a valid payment link with all params", () => {
    const link = generatePaymentLink({
      destination: VALID_ADDRESS,
      amount: "25",
      memo: "thanks",
      assetCode: "XLM",
    });
    const parsed = parsePaymentLink(link);
    expect(parsed).toEqual({
      destination: VALID_ADDRESS,
      amount: "25",
      memo: "thanks",
      assetCode: "XLM",
    });
  });

  it("parses a link with only a destination", () => {
    const link = generatePaymentLink({ destination: VALID_ADDRESS });
    const parsed = parsePaymentLink(link);
    expect(parsed).toEqual({ destination: VALID_ADDRESS });
  });

  it("returns null for an invalid destination address", () => {
    const link = generatePaymentLink({ destination: INVALID_ADDRESS });
    expect(parsePaymentLink(link)).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(parsePaymentLink("not a url")).toBeNull();
  });

  it("returns null when dest param is missing", () => {
    const url = new URL("https://ophirpay.vercel.app/send");
    expect(parsePaymentLink(url)).toBeNull();
  });
});
