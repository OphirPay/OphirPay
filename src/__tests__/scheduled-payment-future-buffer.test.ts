// SPDX-License-Identifier: MIT

import { describe, expect,it } from "vitest";

import { createScheduledPaymentSchema } from "@/lib/validation-schemas";

const ADDRESS = "GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4";

describe("createScheduledPaymentSchema — 60s future buffer (#1952)", () => {
  const basePayment = {
    amount: 100,
    destAddress: ADDRESS,
  };

  it("accepts a date well in the future (> 60s)", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...basePayment,
      scheduledAt: new Date(Date.now() + 120_000).toISOString(), // +2 min
    });
    expect(result.success).toBe(true);
  });

  it("rejects a date in the past", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...basePayment,
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "Scheduled date must be in the future (at least 60 seconds)"
      );
    }
  });

  it("rejects a date only 30 seconds in the future", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...basePayment,
      scheduledAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "Scheduled date must be in the future (at least 60 seconds)"
      );
    }
  });

  it("rejects a date exactly now", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...basePayment,
      scheduledAt: new Date(Date.now()).toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a date exactly 61 seconds in the future", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...basePayment,
      scheduledAt: new Date(Date.now() + 61_000).toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid date string", () => {
    const result = createScheduledPaymentSchema.safeParse({
      ...basePayment,
      scheduledAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });
});
