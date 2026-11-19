import { describe, it, expect } from "vitest";
import { PaymentError, PAYMENT_ERROR_NAMES, ERROR_MESSAGES } from "../types/errors";
import { decodeContractError } from "../lib/contract-errors";

/**
 * Payment Stream duration bounds constants (#1350).
 */
export const MIN_STREAM_DURATION = 60; // 60 seconds
export const MAX_STREAM_DURATION = 5 * 365 * 86_400; // 157,680,000 seconds (5 years)

export function validateStreamDuration(
  startTime: number,
  endTime: number
): { valid: boolean; error?: PaymentError } {
  if (endTime <= startTime) {
    return { valid: false, error: PaymentError.InvalidAmount };
  }
  const duration = endTime - startTime;
  if (duration < MIN_STREAM_DURATION) {
    return { valid: false, error: PaymentError.StreamDurationTooShort };
  }
  if (duration > MAX_STREAM_DURATION) {
    return { valid: false, error: PaymentError.StreamDurationTooLong };
  }
  return { valid: true };
}

describe("Payment Stream Duration Bounds Gate (#1350)", () => {
  it("defines StreamDurationTooShort (310) and StreamDurationTooLong (311) in TypeScript catalog", () => {
    expect(PaymentError.StreamDurationTooShort).toBe(310);
    expect(PaymentError.StreamDurationTooLong).toBe(311);

    expect(PAYMENT_ERROR_NAMES[310]).toBe("StreamDurationTooShort");
    expect(PAYMENT_ERROR_NAMES[311]).toBe("StreamDurationTooLong");

    expect(ERROR_MESSAGES[310].toLowerCase()).toContain("too short");
    expect(ERROR_MESSAGES[311].toLowerCase()).toContain("too long");

    expect(decodeContractError("310").toLowerCase()).toContain("too short");
    expect(decodeContractError("311").toLowerCase()).toContain("too long");
  });

  it("rejects streams shorter than 60 seconds", () => {
    const startTime = 1_700_000_000;

    // 0 seconds
    const zero = validateStreamDuration(startTime, startTime);
    expect(zero.valid).toBe(false);
    expect(zero.error).toBe(PaymentError.InvalidAmount);

    // Negative duration
    const neg = validateStreamDuration(startTime, startTime - 10);
    expect(neg.valid).toBe(false);
    expect(neg.error).toBe(PaymentError.InvalidAmount);

    // 1 second
    const oneSec = validateStreamDuration(startTime, startTime + 1);
    expect(oneSec.valid).toBe(false);
    expect(oneSec.error).toBe(PaymentError.StreamDurationTooShort);

    // 59 seconds
    const shortDur = validateStreamDuration(startTime, startTime + 59);
    expect(shortDur.valid).toBe(false);
    expect(shortDur.error).toBe(PaymentError.StreamDurationTooShort);
  });

  it("rejects streams longer than 5 years", () => {
    const startTime = 1_700_000_000;
    const fiveYears = 5 * 365 * 86_400;

    // 5 years + 1 second
    const tooLong = validateStreamDuration(startTime, startTime + fiveYears + 1);
    expect(tooLong.valid).toBe(false);
    expect(tooLong.error).toBe(PaymentError.StreamDurationTooLong);

    // 10 years
    const tenYears = validateStreamDuration(startTime, startTime + fiveYears * 2);
    expect(tenYears.valid).toBe(false);
    expect(tenYears.error).toBe(PaymentError.StreamDurationTooLong);
  });

  it("accepts valid streams within [60s, 5yr] inclusive", () => {
    const startTime = 1_700_000_000;
    const fiveYears = 5 * 365 * 86_400;

    // Exactly 60 seconds (minimum bound)
    const minBound = validateStreamDuration(startTime, startTime + 60);
    expect(minBound.valid).toBe(true);
    expect(minBound.error).toBeUndefined();

    // 30 days
    const oneMonth = validateStreamDuration(startTime, startTime + 30 * 86_400);
    expect(oneMonth.valid).toBe(true);
    expect(oneMonth.error).toBeUndefined();

    // 1 year
    const oneYear = validateStreamDuration(startTime, startTime + 365 * 86_400);
    expect(oneYear.valid).toBe(true);
    expect(oneYear.error).toBeUndefined();

    // Exactly 5 years (maximum bound)
    const maxBound = validateStreamDuration(startTime, startTime + fiveYears);
    expect(maxBound.valid).toBe(true);
    expect(maxBound.error).toBeUndefined();
  });
});
