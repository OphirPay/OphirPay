// SPDX-License-Identifier: MIT

/**
 * Bounty #1347: token decimal precision mismatch in record_payment.
 *
 * The on-chain contract stores amounts as integer minor units (stroops,
 * 1 XLM = 10^7 stroops). An amount whose fractional part has more digits
 * than the token's decimals cannot be represented exactly — multiplying by
 * 10^decimals and rounding would silently record a different amount than
 * the user approved. `checkAmountPrecision` (and its use inside
 * `recordPaymentOnChain`) rejects such amounts up front.
 */

import { describe, expect, it } from "vitest";
import {
  XLM_DECIMALS,
  checkAmountPrecision,
} from "@/lib/contracts";

describe("checkAmountPrecision", () => {
  it("accepts amounts within the token's decimals", () => {
    expect(checkAmountPrecision("12.5", 7).valid).toBe(true);
    expect(checkAmountPrecision("12.5000007", 7).valid).toBe(true);
    expect(checkAmountPrecision("100", 7).valid).toBe(true);
    expect(checkAmountPrecision("0.01", 2).valid).toBe(true);
    expect(checkAmountPrecision(" 0.5 ", 7).valid).toBe(true);
  });

  it("rejects amounts with more fractional digits than the token decimals", () => {
    const over = checkAmountPrecision("0.00000001", 7);
    expect(over.valid).toBe(false);
    expect(over.error).toMatch(/precision exceeds/i);
    expect(over.error).toMatch(/7 decimal places/);

    // 3 decimals vs a 2-decimal token
    const usdLike = checkAmountPrecision("1.999", 2);
    expect(usdLike.valid).toBe(false);
    expect(usdLike.error).toMatch(/2 decimal places/);
  });

  it("mentions the offending precision in the error", () => {
    const res = checkAmountPrecision("5.12345678", 7);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("8 decimals");
  });

  it("rejects malformed amounts", () => {
    expect(checkAmountPrecision("abc", 7).valid).toBe(false);
    expect(checkAmountPrecision("1.2.3", 7).valid).toBe(false);
    expect(checkAmountPrecision("", 7).valid).toBe(false);
    expect(checkAmountPrecision("1e-8", 7).valid).toBe(false);
  });

  it("accepts when token decimals are unknown metadata", () => {
    // Missing display_decimals in stellar.toml is not evidence of a mismatch.
    expect(checkAmountPrecision("0.00000001", null).valid).toBe(true);
    expect(checkAmountPrecision("0.00000001", undefined).valid).toBe(true);
    // Nonsensical metadata also fails open rather than blocking payments.
    expect(checkAmountPrecision("0.00000001", 2.5).valid).toBe(true);
    expect(checkAmountPrecision("1.5", -1).valid).toBe(true);
  });

  it("accepts any whole amount regardless of decimals", () => {
    expect(checkAmountPrecision("42", 0).valid).toBe(true);
    expect(checkAmountPrecision("1.0", 0).valid).toBe(false); // ".0" exceeds 0 decimals
  });

  it("exposes the XLM decimal constant as 7", () => {
    expect(XLM_DECIMALS).toBe(7);
  });
});
