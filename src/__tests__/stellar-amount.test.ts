// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { formatXlmStroops, parseXlmAmount } from "@/lib/stellar-amount";

describe("XLM amount helpers", () => {
  it("parses decimal XLM amounts into exact stroops", () => {
    expect(parseXlmAmount("12.0000001")).toBe(BigInt(120_000_001));
    expect(parseXlmAmount("0.0000001")).toBe(BigInt(1));
    expect(parseXlmAmount("1.")).toBe(BigInt(10_000_000));
  });

  it("rejects unsupported precision and non-decimal forms", () => {
    expect(parseXlmAmount("1.00000001")).toBeNull();
    expect(parseXlmAmount("1e3")).toBeNull();
    expect(parseXlmAmount("-1")).toBeNull();
  });

  it("formats large amounts without converting through floating point", () => {
    expect(formatXlmStroops("12345678901234567890000000")).toBe("1,234,567,890,123,456,789.00 XLM");
    expect(formatXlmStroops(1)).toBe("0.0000001 XLM");
  });
});
