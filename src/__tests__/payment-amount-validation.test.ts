// SPDX-License-Identifier: MIT
// Zero / negative payment amounts are rejected at the validation layer.

import { describe, it, expect } from "vitest";
import {
  AMOUNT_MUST_BE_POSITIVE_MESSAGE,
  paymentAmountSchema,
} from "@/lib/validation/payment";
import { createPaymentSchema } from "@/lib/validation-schemas";

const validBody = {
  sourceAccountId: "acc1",
  destAddress: "G" + "A".repeat(55),
};

describe("paymentAmountSchema", () => {
  it("rejects zero with an actionable message", () => {
    const result = paymentAmountSchema.safeParse(0);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(AMOUNT_MUST_BE_POSITIVE_MESSAGE);
    }
  });

  it.each([-1, -0.0000001, -1e9])("rejects negative amount %s", (amount) => {
    expect(paymentAmountSchema.safeParse(amount).success).toBe(false);
  });

  it.each([Infinity, NaN])("rejects non-finite amount %s", (amount) => {
    expect(paymentAmountSchema.safeParse(amount).success).toBe(false);
  });

  it("accepts a positive amount", () => {
    expect(paymentAmountSchema.safeParse(0.0000001).success).toBe(true);
    expect(paymentAmountSchema.safeParse(100).success).toBe(true);
  });
});

describe("createPaymentSchema amount", () => {
  it("rejects a zero-amount submission", () => {
    const result = createPaymentSchema.safeParse({ ...validBody, amount: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "amount");
      expect(issue?.message).toBe("Amount must be greater than zero");
    }
  });

  it("rejects a negative-amount submission", () => {
    const result = createPaymentSchema.safeParse({ ...validBody, amount: -5 });
    expect(result.success).toBe(false);
  });

  it("accepts a positive-amount submission", () => {
    const result = createPaymentSchema.safeParse({ ...validBody, amount: 5 });
    expect(result.success).toBe(true);
  });
});
