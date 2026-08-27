// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  createPaymentSchema,
  createBatchSchema,
  createRecurrenceSchema,
  createWebhookSchema,
  createPaymentRequestSchema,
  paginationSchema,
} from "@/lib/validation-schemas";
import {
  validateAmount,
  validateMemo,
  validateMatch,
} from "@/lib/validation-helpers";

// Valid 56-char Stellar address (G + 55 alphanumeric chars)
const VALID_STELLAR = "G" + "A".repeat(55);

// ─── createPaymentSchema ────────────────────────────────────────

describe("createPaymentSchema", () => {
  it("accepts a valid payment", () => {
    const result = createPaymentSchema.safeParse({
      amount: 100.5,
      assetCode: "XLM",
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative amount", () => {
    const result = createPaymentSchema.safeParse({
      amount: -1,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid Stellar address", () => {
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: "not-a-stellar-key",
    });
    expect(result.success).toBe(false);
  });

  it("rejects memo longer than 28 chars", () => {
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
      memo: "this memo is way too long for stellar",
    });
    expect(result.success).toBe(false);
  });

  it("defaults assetCode to XLM", () => {
    const result = createPaymentSchema.safeParse({
      amount: 10,
      sourceAccountId: "user-1",
      destAddress: VALID_STELLAR,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assetCode).toBe("XLM");
  });
});

// ─── createBatchSchema ──────────────────────────────────────────

describe("createBatchSchema", () => {
  it("accepts a valid batch", () => {
    const result = createBatchSchema.safeParse({
      name: "Payroll Jan",
      sourceAccountId: "acct-1",
      recipients: [
        {
          address: VALID_STELLAR,
          amount: 500,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty recipients", () => {
    const result = createBatchSchema.safeParse({
      name: "Empty",
      sourceAccountId: "acct-1",
      recipients: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 100 recipients", () => {
    const recipients = Array.from({ length: 101 }, (_) => ({
      address: VALID_STELLAR,
      amount: 1,
    }));
    const result = createBatchSchema.safeParse({
      name: "Overflow",
      sourceAccountId: "acct-1",
      recipients,
    });
    expect(result.success).toBe(false);
  });
});

// ─── createRecurrenceSchema ─────────────────────────────────────

describe("createRecurrenceSchema", () => {
  it("accepts valid recurrence", () => {
    const result = createRecurrenceSchema.safeParse({
      name: "Monthly rent",
      frequency: "MONTHLY",
      amount: 1500,
      destAddress: VALID_STELLAR,
      sourceAccountId: "acct-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid frequency", () => {
    const result = createRecurrenceSchema.safeParse({
      name: "Bad freq",
      frequency: "HOURLY",
      amount: 10,
      destAddress: VALID_STELLAR,
      sourceAccountId: "acct-1",
    });
    expect(result.success).toBe(false);
  });
});

// ─── createWebhookSchema ────────────────────────────────────────

describe("createWebhookSchema", () => {
  it("accepts a valid webhook", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/webhook",
      events: ["payment.created", "payment.completed"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = createWebhookSchema.safeParse({
      url: "not-a-url",
      events: ["payment.created"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty events array", () => {
    const result = createWebhookSchema.safeParse({
      url: "https://example.com/webhook",
      events: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── createPaymentRequestSchema ─────────────────────────────────

describe("createPaymentRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = createPaymentRequestSchema.safeParse({
      amount: 250,
      assetCode: "USDC",
    });
    expect(result.success).toBe(true);
  });
});

// ─── paginationSchema ───────────────────────────────────────────

describe("paginationSchema", () => {
  it("defaults page=1 limit=50", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(50);
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it("coerces string values", () => {
    const result = paginationSchema.safeParse({ page: "3", limit: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it("accepts an opaque cursor", () => {
    const result = paginationSchema.safeParse({ cursor: "eyJjcmVhdGVkQXQiOiJ4IiwiaWQiOiJ5In0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cursor).toBe("eyJjcmVhdGVkQXQiOiJ4IiwiaWQiOiJ5In0");
    }
  });

  it("caps limit at 100", () => {
    const result = paginationSchema.safeParse({ page: "1", limit: "200" });
    expect(result.success).toBe(false);
  });
});

// ─── validateAmount (lightweight) ────────────────────────────────

describe("validateAmount", () => {
  it("returns null for valid amount", () => {
    expect(validateAmount("100.5")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateAmount("")).toBe("Amount is required");
  });

  it("rejects non-numeric", () => {
    expect(validateAmount("abc")).toBe("Amount must be a number");
  });

  it("rejects zero or negative", () => {
    expect(validateAmount("0")).toBe("Amount must be greater than 0");
    expect(validateAmount("-10")).toBe("Amount must be greater than 0");
  });

  it("rejects more than 7 decimal places", () => {
    expect(validateAmount("0.12345678")).toBe("Amount can have at most 7 decimal places");
  });
});

// ─── validateMemo ───────────────────────────────────────────────

describe("validateMemo", () => {
  it("returns null for valid memo", () => {
    expect(validateMemo("payment-123")).toBeNull();
    expect(validateMemo("")).toBeNull();
  });

  it("rejects memo > 28 chars", () => {
    expect(validateMemo("a".repeat(29))).toBe("Memo must be 28 characters or fewer");
  });
});

// ─── validateMatch ──────────────────────────────────────────────

describe("validateMatch", () => {
  it("returns null when values match", () => {
    expect(validateMatch("GABC", "GABC", "Address")).toBeNull();
  });

  it("returns error when values differ", () => {
    expect(validateMatch("a", "b", "Field")).toBe("Field values do not match");
  });
});
