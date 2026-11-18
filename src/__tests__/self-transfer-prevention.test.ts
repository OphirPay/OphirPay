// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { createPaymentSchema } from "@/lib/validation-schemas";

const VALID_ADDRESS_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2";
const VALID_ADDRESS_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2";

describe("createPaymentSchema — self-transfer prevention (#1960)", () => {
  const basePayment = {
    amount: 100,
    sourceAccountId: VALID_ADDRESS_A,
    destAddress: VALID_ADDRESS_B,
    assetCode: "XLM",
  };

  it("accepts a payment where sender and recipient differ", () => {
    const result = createPaymentSchema.safeParse(basePayment);
    expect(result.success).toBe(true);
  });

  it("rejects a payment where sender and recipient are identical", () => {
    const result = createPaymentSchema.safeParse({
      ...basePayment,
      destAddress: VALID_ADDRESS_A, // same as sourceAccountId
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "Recipient address cannot be identical to sender address"
      );
    }
  });

  it("still validates other fields before the refinement", () => {
    const result = createPaymentSchema.safeParse({
      amount: -1,
      sourceAccountId: "",
      destAddress: "not-valid",
    });
    expect(result.success).toBe(false);
  });
});
