// SPDX-License-Identifier: MIT

/**
 * Static audit and regression test for contract timestamp arithmetic (issue #1284).
 *
 * Verifies that all timestamp offset calculations in both contracts
 * (contracts/ophirpay/src/contract.rs and contracts/emitter/src/lib.rs)
 * use saturating arithmetic (`.saturating_add(...)`) and never raw `+`
 * on ledger timestamps, preventing arithmetic overflow on extreme timestamps.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

describe("Contract Timestamp Arithmetic Standards (Issue #1284)", () => {
  it("contracts/ophirpay/src/contract.rs exists and has zero raw + arithmetic on timestamps", () => {
    const contractPath = "contracts/ophirpay/src/contract.rs";
    expect(existsSync(join(root, contractPath))).toBe(true);

    const source = read(contractPath);
    const lines = source.split("\n");

    // Scan for dangerous patterns like `timestamp() +`, `now +`, `unlock_at +`, etc.
    const rawTimestampAddRegex = /(?:timestamp\(\)|now|unlocks_at|proposed_at|deadline)\s*\+\s*(?:\w+|\d+)/;

    const violatingLines: { lineNum: number; content: string }[] = [];
    lines.forEach((line, index) => {
      // Exclude comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        return;
      }
      if (rawTimestampAddRegex.test(line)) {
        violatingLines.push({ lineNum: index + 1, content: line });
      }
    });

    expect(
      violatingLines,
      `Found raw '+' addition on timestamps in ${contractPath}:\n${JSON.stringify(violatingLines, null, 2)}`
    ).toHaveLength(0);
  });

  it("contracts/emitter/src/lib.rs exists and has zero raw + arithmetic on timestamps", () => {
    const contractPath = "contracts/emitter/src/lib.rs";
    expect(existsSync(join(root, contractPath))).toBe(true);

    const source = read(contractPath);
    const lines = source.split("\n");

    const rawTimestampAddRegex = /(?:timestamp\(\)|now|unlocks_at|proposed_at|deadline)\s*\+\s*(?:\w+|\d+)/;

    const violatingLines: { lineNum: number; content: string }[] = [];
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        return;
      }
      if (rawTimestampAddRegex.test(line)) {
        violatingLines.push({ lineNum: index + 1, content: line });
      }
    });

    expect(
      violatingLines,
      `Found raw '+' addition on timestamps in ${contractPath}:\n${JSON.stringify(violatingLines, null, 2)}`
    ).toHaveLength(0);
  });

  it("verifies saturating_add is used for timelock delays across both contracts", () => {
    const ophirpaySource = read("contracts/ophirpay/src/contract.rs");
    const emitterSource = read("contracts/emitter/src/lib.rs");

    // Both contracts must use saturating_add with timelock delay
    expect(ophirpaySource).toContain("now.saturating_add(TMLOCK_DELAY)");
    expect(ophirpaySource).toContain("saturating_add(TMLOCK_DELAY)");
    expect(emitterSource).toContain("saturating_add(TMLOCK_DELAY)");
  });
});
