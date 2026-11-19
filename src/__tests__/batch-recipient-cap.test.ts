// SPDX-License-Identifier: MIT
// Batch requests are capped at 100 recipients and rejected as RFC 7807 problems.

import { describe, it, expect } from "vitest";
import { createBatchSchema } from "@/lib/validation-schemas";
import { problemFromZodError } from "@/lib/api-errors";
import {
  BATCH_RECIPIENTS_MAX_MESSAGE,
  MAX_BATCH_RECIPIENTS,
} from "@/lib/validation/batch";

const ADDRESS = "G" + "A".repeat(55);

function batchWith(count: number) {
  return {
    name: "Payroll",
    sourceAccountId: "acc1",
    recipients: Array.from({ length: count }, () => ({
      address: ADDRESS,
      amount: 1,
    })),
  };
}

describe("createBatchSchema recipient cap", () => {
  it("caps a batch at 100 recipients", () => {
    expect(MAX_BATCH_RECIPIENTS).toBe(100);
  });

  it("accepts exactly 100 recipients", () => {
    expect(createBatchSchema.safeParse(batchWith(100)).success).toBe(true);
  });

  it("rejects 101 recipients with a descriptive message", () => {
    const result = createBatchSchema.safeParse(batchWith(101));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "recipients");
      expect(issue?.message).toBe(BATCH_RECIPIENTS_MAX_MESSAGE);
      expect(issue?.message).toContain("100");
    }
  });

  it("rejects an empty recipient list", () => {
    expect(createBatchSchema.safeParse(batchWith(0)).success).toBe(false);
  });

  it("is reported as a 400 RFC 7807 problem document", async () => {
    const result = createBatchSchema.safeParse(batchWith(101));
    expect(result.success).toBe(false);
    if (result.success) return;

    const res = problemFromZodError(result.error, { instance: "/api/batches" });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");

    const body = await res.json();
    expect(body).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      instance: "/api/batches",
      detail: BATCH_RECIPIENTS_MAX_MESSAGE,
    });
    expect(body.errors).toEqual([
      expect.objectContaining({
        field: "recipients",
        message: BATCH_RECIPIENTS_MAX_MESSAGE,
      }),
    ]);
  });
});
