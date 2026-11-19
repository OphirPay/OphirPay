// SPDX-License-Identifier: MIT
//
// Issue #718 — Assert the TypeScript contract-errors catalog is up-to-date
// with the Rust source.
//
// The Rust-side test (contracts/ophirpay/tests/error_uniqueness.rs) guards
// against duplicate discriminants. This test guards the TS → Rust mapping.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateCatalog } from "../../scripts/regenerate-errors";

const root = process.cwd();

describe("Contract error catalog completeness — #718", () => {
  it("TypeScript catalog is up to date with Rust source", () => {
    const tsPath = join(root, "src/lib/contract-errors.ts");
    const currentTs = readFileSync(tsPath, "utf8");
    const expectedTs = generateCatalog();

    // If this fails, run `npm run generate-errors`
    expect(currentTs).toBe(expectedTs);
  });
});
