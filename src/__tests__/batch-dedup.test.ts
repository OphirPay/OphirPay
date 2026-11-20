// SPDX-License-Identifier: MIT

import { describe, expect,it } from "vitest";

import { processBatchRecipients } from "@/lib/batch-processor";
import { validateBatchRecipients } from "@/lib/batch-validator";

const ADDR_A = "G" + "A".repeat(55);
const ADDR_B = "G" + "B".repeat(55);

describe("batch recipient deduplication", () => {
  describe("duplicate flagging", () => {
    it("flags a batch containing two identical recipient addresses", () => {
      const result = processBatchRecipients([
        { address: ADDR_A, amount: 10 },
        { address: ADDR_A, amount: 5 },
      ]);

      expect(result.duplicates).toEqual([
        { address: ADDR_A, indices: [0, 1], combined: false },
      ]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(ADDR_A);
      expect(result.warnings[0]).toContain("rows 1, 2");
    });

    it("does not combine entries by default", () => {
      const result = processBatchRecipients([
        { address: ADDR_A, amount: 10 },
        { address: ADDR_A, amount: 5 },
      ]);
      expect(result.recipients).toHaveLength(2);
    });

    it("produces no warnings when all addresses are unique", () => {
      const result = processBatchRecipients([
        { address: ADDR_A, amount: 10 },
        { address: ADDR_B, amount: 5 },
      ]);
      expect(result.duplicates).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("validator reports the duplicate row as an error", () => {
      const result = validateBatchRecipients([
        { address: ADDR_A, amount: 10 },
        { address: ADDR_A, amount: 5 },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual({
        index: 1,
        field: "address",
        message: "Duplicate address.",
      });
    });
  });

  describe("combine option", () => {
    it("combines amounts of duplicate addresses into a single payment", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 10 },
          { address: ADDR_B, amount: 3 },
          { address: ADDR_A, amount: 5 },
        ],
        { combineDuplicates: true }
      );

      expect(result.recipients).toEqual([
        { address: ADDR_A, amount: 15 },
        { address: ADDR_B, amount: 3 },
      ]);
      expect(result.duplicates).toEqual([
        { address: ADDR_A, indices: [0, 2], combined: true },
      ]);
    });

    it("combines more than two duplicates", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 1 },
          { address: ADDR_A, amount: 2 },
          { address: ADDR_A, amount: 3 },
        ],
        { combineDuplicates: true }
      );
      expect(result.recipients).toEqual([{ address: ADDR_A, amount: 6 }]);
    });

    it("avoids floating point drift when summing amounts", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 0.1 },
          { address: ADDR_A, amount: 0.2 },
        ],
        { combineDuplicates: true }
      );
      expect(result.recipients[0].amount).toBe(0.3);
    });

    it("does not mutate the input recipients", () => {
      const input = [
        { address: ADDR_A, amount: 10 },
        { address: ADDR_A, amount: 5 },
      ];
      processBatchRecipients(input, { combineDuplicates: true });
      expect(input[0].amount).toBe(10);
    });

    it("combines entries with the same memo", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 10, memo: "invoice-1" },
          { address: ADDR_A, amount: 5, memo: "invoice-1" },
        ],
        { combineDuplicates: true }
      );
      expect(result.recipients).toEqual([
        { address: ADDR_A, amount: 15, memo: "invoice-1" },
      ]);
    });
  });

  describe("memo differences", () => {
    it("does not combine duplicates with different memos", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 10, memo: "invoice-1" },
          { address: ADDR_A, amount: 5, memo: "invoice-2" },
        ],
        { combineDuplicates: true }
      );

      expect(result.recipients).toHaveLength(2);
      expect(result.recipients.map((r) => r.amount)).toEqual([10, 5]);
      // Still reported as a duplicate address, but not combined.
      expect(result.duplicates).toEqual([
        { address: ADDR_A, indices: [0, 1], combined: false },
      ]);
    });

    it("does not combine when only one entry has a memo", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 10, memo: "invoice-1" },
          { address: ADDR_A, amount: 5 },
        ],
        { combineDuplicates: true }
      );
      expect(result.recipients).toHaveLength(2);
    });

    it("treats a missing memo and an empty memo as equal", () => {
      const result = processBatchRecipients(
        [
          { address: ADDR_A, amount: 10 },
          { address: ADDR_A, amount: 5, memo: "" },
        ],
        { combineDuplicates: true }
      );
      expect(result.recipients).toHaveLength(1);
      expect(result.recipients[0].amount).toBe(15);
    });
  });
});
