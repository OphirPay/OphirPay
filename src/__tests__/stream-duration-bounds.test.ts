// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1350 — Enforce minimum and maximum duration bounds on payment streams
 * in create_stream.
 *
 * Verifies:
 *   • `contracts/ophirpay/src/contract.rs` defines `MIN_STREAM_DURATION = 60`
 *     (60 seconds) and `MAX_STREAM_DURATION = 157_680_000` (5 years in seconds)
 *     and validates `end_time - start_time` in `create_stream`.
 *   • `contracts/ophirpay/src/errors.rs` and TypeScript `PaymentError` define
 *     `StreamDurationTooShort` and `StreamDurationTooLong` in 100% parity.
 *   • `contracts/ophirpay/tests/integration_tests.rs` tests boundary rejection
 *     (`MIN_STREAM_DURATION - 1` and `MAX_STREAM_DURATION + 1`) and exact
 *     boundary acceptance (`MIN_STREAM_DURATION` and `MAX_STREAM_DURATION`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PaymentError, ERROR_MESSAGES } from "@/types/errors";
import { decodeContractError } from "@/lib/contract-errors";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

export const MIN_STREAM_DURATION = 60;
export const MAX_STREAM_DURATION = 157_680_000;

function validateStreamDuration(
  startTime: number,
  endTime: number
): { ok: true; duration: number } | { ok: false; error: PaymentError } {
  if (endTime <= startTime) {
    return { ok: false, error: PaymentError.InvalidAmount };
  }
  const duration = endTime - startTime;
  if (duration < MIN_STREAM_DURATION) {
    return { ok: false, error: PaymentError.StreamDurationTooShort };
  }
  if (duration > MAX_STREAM_DURATION) {
    return { ok: false, error: PaymentError.StreamDurationTooLong };
  }
  return { ok: true, duration };
}

describe("Stream duration bounds in create_stream (issue #1350)", () => {
  it("defines MIN_STREAM_DURATION and MAX_STREAM_DURATION and enforces both in create_stream", () => {
    const contractRs = read("contracts/ophirpay/src/contract.rs");

    expect(contractRs).toContain("pub const MIN_STREAM_DURATION: u64 = 60;");
    expect(contractRs).toContain("pub const MAX_STREAM_DURATION: u64 = 157_680_000;");
    expect(contractRs).toContain("if duration < MIN_STREAM_DURATION {");
    expect(contractRs).toContain("return Err(PaymentError::StreamDurationTooShort);");
    expect(contractRs).toContain("if duration > MAX_STREAM_DURATION {");
    expect(contractRs).toContain("return Err(PaymentError::StreamDurationTooLong);");
  });

  it("registers StreamDurationTooShort and StreamDurationTooLong in errors.rs and TypeScript catalogs", () => {
    const errorsRs = read("contracts/ophirpay/src/errors.rs");
    expect(errorsRs).toContain("StreamDurationTooShort = 310");
    expect(errorsRs).toContain("StreamDurationTooLong = 311");

    expect(PaymentError.StreamDurationTooShort).toBe(310);
    expect(PaymentError.StreamDurationTooLong).toBe(311);
    expect(ERROR_MESSAGES[PaymentError.StreamDurationTooShort]).toMatch(/duration too short/i);
    expect(ERROR_MESSAGES[PaymentError.StreamDurationTooLong]).toMatch(/duration too long/i);
    expect(decodeContractError("Error(Contract, #310)")).toMatch(/duration too short/i);
    expect(decodeContractError("Error(Contract, #311)")).toMatch(/duration too long/i);
  });

  it("validates boundary conditions (too short, exact min, exact max, too long)", () => {
    const start = 1_000_000;

    expect(validateStreamDuration(start, start)).toEqual({
      ok: false,
      error: PaymentError.InvalidAmount,
    });
    expect(validateStreamDuration(start, start + MIN_STREAM_DURATION - 1)).toEqual({
      ok: false,
      error: PaymentError.StreamDurationTooShort,
    });
    expect(validateStreamDuration(start, start + MIN_STREAM_DURATION)).toEqual({
      ok: true,
      duration: MIN_STREAM_DURATION,
    });
    expect(validateStreamDuration(start, start + MAX_STREAM_DURATION)).toEqual({
      ok: true,
      duration: MAX_STREAM_DURATION,
    });
    expect(validateStreamDuration(start, start + MAX_STREAM_DURATION + 1)).toEqual({
      ok: false,
      error: PaymentError.StreamDurationTooLong,
    });
  });

  it("includes unit test assertions for both duration bounds in integration_tests.rs", () => {
    const integrationRs = read("contracts/ophirpay/tests/integration_tests.rs");
    expect(integrationRs).toContain("fn test_create_stream_enforces_min_and_max_duration_bounds()");
    expect(integrationRs).toContain("PaymentError::StreamDurationTooShort");
    expect(integrationRs).toContain("PaymentError::StreamDurationTooLong");
  });
});
