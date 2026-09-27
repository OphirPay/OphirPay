// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #778 — `docs/ERROR_CODES.md` documents every error code reachable
 * from the API / lib layer (taxonomy codes, Soroban contract codes, Horizon
 * result codes) in one table: code, HTTP status, meaning, trigger condition,
 * and retryable-vs-terminal.
 *
 * The doc is generated from the same source modules the taxonomy tests pin
 * (`error-taxonomy.test.ts`), so it cannot silently drift: this test
 * regenerates it and diffs against the checked-in file (mirrors the pattern
 * in `contract-error-catalog.test.ts` for issue #718), and independently
 * verifies every code from each source module is actually covered — so a
 * bug in the generator itself can't hide a missing code.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_TAXONOMY, RETRYABLE_STATUSES } from "@/lib/error-codes";
import { getContractErrorCatalog } from "@/lib/contract-errors";
import { HORIZON_ERROR_MESSAGES } from "@/lib/stellar-error";
import { generateErrorCodesDoc } from "../../scripts/generate-error-docs";

const root = process.cwd();
const docPath = join(root, "docs/ERROR_CODES.md");
const readDoc = () => readFileSync(docPath, "utf8");

describe("docs/ERROR_CODES.md — generated, cannot drift (#778)", () => {
  it("matches the generator's output exactly", () => {
    // If this fails, run `npm run generate-error-docs`.
    expect(readDoc()).toBe(generateErrorCodesDoc());
  });

  it("covers every taxonomy code with its HTTP status and retryable flag", () => {
    const doc = readDoc();
    const entries = Object.values(ERROR_TAXONOMY);
    expect(entries.length).toBeGreaterThanOrEqual(200);
    for (const def of entries) {
      const row = doc
        .split("\n")
        .find((line) => line.startsWith(`| \`${def.code}\` |`));
      expect(row, `missing doc row for ${def.code}`).toBeDefined();
      expect(row).toContain(`| ${def.status} |`);
      expect(row).toContain(def.retryable ? "| Retryable |" : "| Terminal |");
    }
  });

  it("agrees with RETRYABLE_STATUSES on which statuses are retryable", () => {
    for (const def of Object.values(ERROR_TAXONOMY)) {
      expect(def.retryable).toBe(RETRYABLE_STATUSES.has(def.status));
    }
  });

  it("covers every Soroban contract error code", () => {
    const doc = readDoc();
    const contractEntries = getContractErrorCatalog();
    expect(contractEntries.length).toBeGreaterThan(0);
    for (const { code } of contractEntries) {
      expect(
        doc.includes(`| \`${code}\` |`),
        `missing doc row for contract code ${code}`,
      ).toBe(true);
    }
  });

  it("covers every Horizon result code", () => {
    const doc = readDoc();
    const horizonKeys = Object.keys(HORIZON_ERROR_MESSAGES);
    expect(horizonKeys.length).toBeGreaterThan(0);
    for (const key of horizonKeys) {
      expect(
        doc.includes(`| \`${key}\` |`),
        `missing doc row for Horizon code ${key}`,
      ).toBe(true);
    }
  });

  it("documents the retryable-vs-terminal legend", () => {
    const doc = readDoc();
    expect(doc).toContain("Retryable vs. terminal");
    expect(doc.toLowerCase()).toContain("terminal");
  });
});
