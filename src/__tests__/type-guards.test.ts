// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  isNonNull,
  isString,
  isNumber,
  isStellarKey,
  isError,
  isOnChainId,
} from "@/lib/type-guards";

// ─── isOnChainId ────────────────────────────────────────────────
// Guards on-chain action buttons: a valid on-chain record id is a positive
// safe u64 integer (number or numeric string). Prisma cuid strings and other
// non-numeric values must be rejected so the contract is never called with
// Number("cm...") = NaN.

describe("isOnChainId", () => {
  it("accepts positive integers as numbers", () => {
    expect(isOnChainId(1)).toBe(true);
    expect(isOnChainId(42)).toBe(true);
    expect(isOnChainId(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("accepts numeric strings", () => {
    expect(isOnChainId("1")).toBe(true);
    expect(isOnChainId("42")).toBe(true);
    expect(isOnChainId("9007199254740991")).toBe(true); // MAX_SAFE_INTEGER
  });

  it("rejects zero and negatives", () => {
    expect(isOnChainId(0)).toBe(false);
    expect(isOnChainId(-1)).toBe(false);
    expect(isOnChainId("0")).toBe(false);
    expect(isOnChainId("-5")).toBe(false);
  });

  it("rejects decimals", () => {
    expect(isOnChainId(1.5)).toBe(false);
    expect(isOnChainId("1.5")).toBe(false);
  });

  it("rejects Prisma cuid strings and non-numeric values", () => {
    expect(isOnChainId("cm3k8v0a1000000abc1234def")).toBe(false);
    expect(isOnChainId("abc")).toBe(false);
    expect(isOnChainId("")).toBe(false);
    expect(isOnChainId("  ")).toBe(false);
    expect(isOnChainId(null)).toBe(false);
    expect(isOnChainId(undefined)).toBe(false);
  });

  it("rejects exponent notation and hex (not plain digits)", () => {
    expect(isOnChainId("1e3")).toBe(false);
    expect(isOnChainId("0x10")).toBe(false);
    expect(isOnChainId("+42")).toBe(false);
  });

  it("rejects integers beyond the safe range (precision loss)", () => {
    expect(isOnChainId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isOnChainId("9007199254740992")).toBe(false); // 2^53
  });

  it("accepts trimmed numeric strings", () => {
    expect(isOnChainId(" 42 ")).toBe(true);
  });
});

// ─── Other type guards ──────────────────────────────────────────

describe("isNonNull", () => {
  it("narrows null/undefined out", () => {
    expect(isNonNull(0)).toBe(true);
    expect(isNonNull("")).toBe(true);
    expect(isNonNull(null)).toBe(false);
    expect(isNonNull(undefined)).toBe(false);
  });
});

describe("isString", () => {
  it("detects strings", () => {
    expect(isString("x")).toBe(true);
    expect(isString(5)).toBe(false);
    expect(isString(null)).toBe(false);
  });
});

describe("isNumber", () => {
  it("rejects NaN", () => {
    expect(isNumber(5)).toBe(true);
    expect(isNumber(NaN)).toBe(false);
    expect(isNumber("5")).toBe(false);
  });
});

describe("isStellarKey", () => {
  it("matches 56-char G... keys", () => {
    expect(isStellarKey("G" + "A".repeat(55))).toBe(true);
    expect(isStellarKey("not-a-key")).toBe(false);
    expect(isStellarKey("H" + "A".repeat(55))).toBe(false);
  });
});

describe("isError", () => {
  it("detects Error instances", () => {
    expect(isError(new Error("boom"))).toBe(true);
    expect(isError("boom")).toBe(false);
  });
});
