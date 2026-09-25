// SPDX-License-Identifier: MIT
//
// Issue #718 — Assert the TypeScript contract-errors catalog is up-to-date
// with the Rust source.
// Issue #766 — Assert the trimmed catalog advertises only reachable codes and
// never a reserved placeholder.
//
// The Rust-side test (contracts/ophirpay/tests/error_uniqueness.rs) guards
// against duplicate discriminants and reserved-range collisions.
// This test guards the TS → Rust mapping.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateCatalog } from "../../scripts/regenerate-errors";
import {
  CONTRACT_ERROR_MAP,
  decodeContractError,
  getContractErrorCatalog,
} from "@/lib/contract-errors";

const root = process.cwd();

/**
 * Reserved (unallocated) code ranges — mirrors the PaymentError enum and
 * docs/SPEC.md § "Error code allocation". Kept in sync by hand.
 */
const RESERVED_CODE_RANGES: Array<[number, number]> = [
  [15, 16],
  [28, 28],
  [33, 34],
  [43, 44],
  [49, 50],
  [53, 61],
  [63, 64],
  [66, 90],
  [92, 300],
];

/** Highest code the contract has ever allocated (StreamInvariantViolated). */
const MAX_ERROR_CODE = 307;

describe("Contract error catalog completeness — #718", () => {
  it("TypeScript catalog is up to date with Rust source", () => {
    const tsPath = join(root, "src/lib/contract-errors.ts");
    const currentTs = readFileSync(tsPath, "utf8");
    const expectedTs = generateCatalog();

    // If this fails, run `npm run generate-errors`
    expect(currentTs).toBe(expectedTs);
  });
});

describe("Trimmed contract error catalog — #766", () => {
  const catalog = getContractErrorCatalog();

  it("advertises only codes within the documented ceiling", () => {
    expect(catalog.length).toBeGreaterThan(0);
    for (const { code } of catalog) {
      const value = Number(code);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(MAX_ERROR_CODE);
    }
  });

  it("never advertises a reserved (unallocated) code", () => {
    for (const { code } of catalog) {
      const value = Number(code);
      for (const [low, high] of RESERVED_CODE_RANGES) {
        expect(value < low || value > high).toBe(true);
      }
    }
  });

  it("allocated codes and reserved ranges partition 1..=307", () => {
    const seen = new Set<number>();

    for (const { code } of catalog) {
      const value = Number(code);
      expect(seen.has(value)).toBe(false);
      seen.add(value);
    }

    for (const [low, high] of RESERVED_CODE_RANGES) {
      expect(low).toBeLessThanOrEqual(high);
      for (let value = low; value <= high; value += 1) {
        expect(seen.has(value)).toBe(false);
        seen.add(value);
      }
    }

    for (let value = 1; value <= MAX_ERROR_CODE; value += 1) {
      expect(seen.has(value)).toBe(true);
    }
    expect(seen.size).toBe(MAX_ERROR_CODE);
  });

  it("keeps reachable messages stable and drops reserved placeholders", () => {
    const reentrant = "Reentrant call detected: cross-contract reentry blocked";

    expect(CONTRACT_ERROR_MAP["52"]).toBe(reentrant);
    expect(decodeContractError("Error(Contract, #52)")).toBe(reentrant);
    expect(decodeContractError("Error(Contract, #307)")).toBe(
      "Stream accounting invariant violated: refused to pay an inconsistent amount",
    );

    // 94 was `StakingNotConfigured`, a placeholder for a feature the contract
    // does not implement: it must no longer be advertised, so decoding falls
    // back to the raw error string.
    expect(CONTRACT_ERROR_MAP["94"]).toBeUndefined();
    expect(decodeContractError("Error(Contract, #94)")).toBe(
      "Error(Contract, #94)",
    );
  });
});
