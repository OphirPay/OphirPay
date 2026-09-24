// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ERROR_CODES,
  ERROR_STATUS,
  RETRYABLE_ERROR_CODES,
  isRetryableError,
  isTerminalError,
  getErrorStatus,
} from "@/lib/error-codes";

describe("API Error Reference Table & Status Mapping (#778)", () => {
  const rootDir = process.cwd();
  const docPath = path.join(rootDir, "docs/API_ERRORS.md");

  it("ensures docs/API_ERRORS.md exists and is non-empty", () => {
    expect(fs.existsSync(docPath)).toBe(true);
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content.length).toBeGreaterThan(1000);
  });

  it("verifies every error code in ERROR_CODES appears in docs/API_ERRORS.md with its status and policy", () => {
    const content = fs.readFileSync(docPath, "utf-8");
    const allCodes = Object.values(ERROR_CODES);

    expect(allCodes.length).toBeGreaterThanOrEqual(200);

    const missingCodes: string[] = [];
    const mismatchedStatuses: string[] = [];
    const mismatchedPolicies: string[] = [];

    for (const code of allCodes) {
      // Must appear as backtick-enclosed code in the table: `CODE`
      const codeRegex = new RegExp(`\\|\\s*\`${code}\`\\s*\\|\\s*\\*\\*(\\d+)\\*\\*\\s*\\|\\s*([^|]+)\\|`);
      const match = content.match(codeRegex);

      if (!match) {
        missingCodes.push(code);
        continue;
      }

      const documentedStatus = parseInt(match[1], 10);
      const documentedPolicy = match[2].trim();
      const expectedStatus = ERROR_STATUS[code];
      const isRetryable = RETRYABLE_ERROR_CODES.has(code);

      if (documentedStatus !== expectedStatus) {
        mismatchedStatuses.push(
          `${code}: documented ${documentedStatus}, expected ${expectedStatus}`
        );
      }

      if (isRetryable && !documentedPolicy.includes("Retryable")) {
        mismatchedPolicies.push(`${code}: expected Retryable, got ${documentedPolicy}`);
      } else if (!isRetryable && !documentedPolicy.includes("Terminal")) {
        mismatchedPolicies.push(`${code}: expected Terminal, got ${documentedPolicy}`);
      }
    }

    expect(
      missingCodes,
      `All ERROR_CODES must appear in docs/API_ERRORS.md. Missing: ${missingCodes.join(", ")}`
    ).toEqual([]);

    expect(
      mismatchedStatuses,
      `All documented HTTP statuses must match ERROR_STATUS: ${mismatchedStatuses.join("; ")}`
    ).toEqual([]);

    expect(
      mismatchedPolicies,
      `All retryable/terminal policies must match: ${mismatchedPolicies.join("; ")}`
    ).toEqual([]);
  });

  it("verifies isRetryableError and isTerminalError partition codes correctly", () => {
    expect(isRetryableError(ERROR_CODES.RATE_LIMITED)).toBe(true);
    expect(isRetryableError(ERROR_CODES.REQUEST_TIMEOUT)).toBe(true);
    expect(isRetryableError(ERROR_CODES.SERVICE_UNAVAILABLE)).toBe(true);
    expect(isRetryableError(ERROR_CODES.DATABASE_DEADLOCK)).toBe(true);

    expect(isRetryableError(ERROR_CODES.BAD_REQUEST)).toBe(false);
    expect(isRetryableError(ERROR_CODES.VALIDATION_ERROR)).toBe(false);
    expect(isRetryableError(ERROR_CODES.UNAUTHORIZED)).toBe(false);
    expect(isRetryableError(ERROR_CODES.NOT_FOUND)).toBe(false);

    expect(isTerminalError(ERROR_CODES.VALIDATION_ERROR)).toBe(true);
    expect(isTerminalError(ERROR_CODES.RATE_LIMITED)).toBe(false);
  });

  it("verifies getErrorStatus returns matching status codes", () => {
    expect(getErrorStatus(ERROR_CODES.VALIDATION_ERROR)).toBe(400);
    expect(getErrorStatus(ERROR_CODES.UNAUTHORIZED)).toBe(401);
    expect(getErrorStatus(ERROR_CODES.INSUFFICIENT_FUNDS)).toBe(402);
    expect(getErrorStatus(ERROR_CODES.FORBIDDEN)).toBe(403);
    expect(getErrorStatus(ERROR_CODES.NOT_FOUND)).toBe(404);
    expect(getErrorStatus(ERROR_CODES.CONFLICT)).toBe(409);
    expect(getErrorStatus(ERROR_CODES.RATE_LIMITED)).toBe(429);
    expect(getErrorStatus(ERROR_CODES.INTERNAL_ERROR)).toBe(500);
    expect(getErrorStatus(ERROR_CODES.SERVICE_UNAVAILABLE)).toBe(503);
    expect(getErrorStatus("UNKNOWN_NONEXISTENT_CODE")).toBe(500);
  });
});
