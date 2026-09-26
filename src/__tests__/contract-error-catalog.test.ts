// SPDX-License-Identifier: MIT
//
// Issues #718, #766 — Assert the TypeScript contract-errors catalog is up-to-date
// with the Rust source, trimmed to reachable variants, and handles reserved ranges properly.

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

describe("Contract error catalog completeness — #718, #766", () => {
  it("TypeScript catalog is up to date with Rust source", () => {
    const tsPath = join(root, "src/lib/contract-errors.ts");
    const currentTs = readFileSync(tsPath, "utf8");
    const expectedTs = generateCatalog();

    // If this fails, run `npm run generate-errors`
    expect(currentTs).toBe(expectedTs);
  });

  it("contains exactly 54 reachable error codes (#766)", () => {
    const catalog = getContractErrorCatalog();
    expect(catalog.length).toBe(54);
    expect(Object.keys(CONTRACT_ERROR_MAP).length).toBe(54);
  });

  it("does not advertise reserved placeholder codes (#766)", () => {
    // Reserved ranges from docs/AUDIT.md LOW-6 & SPEC.md
    const reservedSamples = ["15", "16", "28", "33", "34", "43", "44", "49", "50", "53", "100", "200", "300"];
    for (const code of reservedSamples) {
      expect(CONTRACT_ERROR_MAP[code]).toBeUndefined();
    }
  });

  it("decodes reachable codes and falls back to raw string for reserved/unknown codes", () => {
    // Reachable codes
    expect(decodeContractError("1")).toBe("Contract not initialized: call init() first");
    expect(decodeContractError("Error(Contract, #1)")).toBe("Contract not initialized: call init() first");
    expect(decodeContractError("308")).toBe("Pause scope not recognized: unknown scope identifier");

    // Reserved codes fall back to raw input
    expect(decodeContractError("300")).toBe("300");
    expect(decodeContractError("Error(Contract, #300)")).toBe("Error(Contract, #300)");
    expect(decodeContractError("Error(Contract, #999)")).toBe("Error(Contract, #999)");
  });
});
