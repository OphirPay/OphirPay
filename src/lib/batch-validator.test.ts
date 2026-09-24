import { describe, expect, it } from "vitest";
import {
  BATCH_TOTAL_OVERFLOW_MSG,
  I128_MAX,
  validateBatch,
} from "./batch-validator";

describe("validateBatch overflow", () => {
  it("rejects a total above i128 max", () => {
    const result = validateBatch([
      { address: "G1", amount: I128_MAX },
      { address: "G2", amount: 1n },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(BATCH_TOTAL_OVERFLOW_MSG);
  });

  it("accepts a total equal to i128 max", () => {
    const result = validateBatch([{ address: "G1", amount: I128_MAX }]);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(I128_MAX.toString());
  });
});
