// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  createBatchSchema,
  batchRecipientSchema,
  MAX_BATCH_RECIPIENTS,
  MIN_BATCH_RECIPIENTS,
} from "@/lib/validation/batch";
import { problemFromZodError } from "@/lib/api-errors";

const VALID_STELLAR_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function generateRecipients(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    address: VALID_STELLAR_ADDRESS,
    amount: (i + 1) * 10,
    assetCode: "XLM",
    memo: `Payout ${i + 1}`,
    memoType: "MEMO_TEXT" as const,
  }));
}

describe("Batch Validation Schema (Issue #1946)", () => {
  it("exports MAX_BATCH_RECIPIENTS as 100", () => {
    expect(MAX_BATCH_RECIPIENTS).toBe(100);
    expect(MIN_BATCH_RECIPIENTS).toBe(1);
  });

  it("accepts a batch payload with exactly 1 recipient (minimum boundary)", () => {
    const payload = {
      name: "Single Recipient Batch",
      sourceAccountId: "source_acc_123",
      recipients: generateRecipients(1),
    };

    const parsed = createBatchSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recipients).toHaveLength(1);
    }
  });

  it("accepts a batch payload with exactly 100 recipients (maximum boundary)", () => {
    const payload = {
      name: "Max Capacity Batch",
      sourceAccountId: "source_acc_123",
      recipients: generateRecipients(100),
    };

    const parsed = createBatchSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recipients).toHaveLength(100);
    }
  });

  it("rejects a batch payload with 101 recipients (exceeding maximum ceiling)", () => {
    const payload = {
      name: "Oversized Batch",
      sourceAccountId: "source_acc_123",
      recipients: generateRecipients(101),
    };

    const parsed = createBatchSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const recipientIssue = issues.find((issue) =>
        issue.path.includes("recipients")
      );
      expect(recipientIssue).toBeDefined();
      expect(recipientIssue?.message).toContain("100");
    }
  });

  it("rejects a batch payload with 0 recipients (empty array)", () => {
    const payload = {
      name: "Empty Batch",
      sourceAccountId: "source_acc_123",
      recipients: [],
    };

    const parsed = createBatchSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const recipientIssue = issues.find((issue) =>
        issue.path.includes("recipients")
      );
      expect(recipientIssue).toBeDefined();
    }
  });

  it("formats RFC 7807 problem details response on validation failure", async () => {
    const payload = {
      name: "Invalid Oversized Batch",
      sourceAccountId: "source_acc_123",
      recipients: generateRecipients(101),
    };

    const parsed = createBatchSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const response = problemFromZodError(parsed.error, {
        instance: "/api/batches",
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toBe(
        "application/problem+json"
      );

      const json = await response.json();
      expect(json.status).toBe(400);
      expect(json.code).toBe("VALIDATION_ERROR");
      expect(json.instance).toBe("/api/batches");
      expect(Array.isArray(json.errors)).toBe(true);
      expect(json.errors.some((e: { field: string }) => e.field === "recipients")).toBe(
        true
      );
    }
  });
});
