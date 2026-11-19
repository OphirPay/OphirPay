// SPDX-License-Identifier: MIT

/**
 * Error Code Registry Uniqueness & TypeScript Parity Test (#1411).
 *
 * Verifies that:
 * 1. Every contract error in contracts/ophirpay/src/errors.rs has a strictly unique integer discriminant.
 * 2. TypeScript error catalog src/types/errors.ts matches the Rust contract enum 1:1 with zero drift.
 * 3. Human-readable error messages are present for all error codes.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PaymentError,
  PAYMENT_ERROR_NAMES,
  PAYMENT_ERROR_DISCRIMINANTS,
  ERROR_MESSAGES,
} from "../types/errors";
import { parseRustErrors, checkParity } from "../../scripts/regenerate-errors";

const ROOT = process.cwd();
const rustErrorsPath = path.join(ROOT, "contracts/ophirpay/src/errors.rs");

describe("Error code registry uniqueness & TypeScript mirroring (#1411)", () => {
  it("verifies every Rust PaymentError discriminant is strictly unique", () => {
    const rs = fs.readFileSync(rustErrorsPath, "utf8");
    const variantRegex = /^\s*(\w+)\s*=\s*(\d+),?/gm;

    const seenCodes = new Map<number, string>();
    const seenNames = new Map<string, number>();
    const duplicates: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = variantRegex.exec(rs)) !== null) {
      const name = match[1];
      const code = parseInt(match[2], 10);

      if (seenCodes.has(code)) {
        duplicates.push(
          `Code ${code} is assigned to both '${seenCodes.get(code)}' and '${name}'`,
        );
      } else {
        seenCodes.set(code, name);
      }

      if (seenNames.has(name)) {
        duplicates.push(
          `Variant '${name}' is declared multiple times (codes: ${seenNames.get(name)}, ${code})`,
        );
      } else {
        seenNames.set(name, code);
      }
    }

    expect(duplicates, duplicates.join("; ")).toEqual([]);
    expect(seenCodes.size).toBeGreaterThanOrEqual(300);
  });

  it("verifies 100% parity between Rust contract enum and TypeScript PaymentError", () => {
    const entries = parseRustErrors();

    // Check count
    expect(entries.length).toBeGreaterThanOrEqual(300);

    for (const { name, code } of entries) {
      // Check enum mapping
      const enumValue = PaymentError[name as keyof typeof PaymentError];
      expect(
        enumValue,
        `PaymentError.${name} should be ${code} but was ${enumValue}`,
      ).toBe(code);

      // Check reverse enum lookup
      expect(PaymentError[code as unknown as keyof typeof PaymentError]).toBe(
        name,
      );

      // Check name dictionary
      expect(PAYMENT_ERROR_NAMES[code]).toBe(name);

      // Check discriminant dictionary
      expect(PAYMENT_ERROR_DISCRIMINANTS[name]).toBe(code);

      // Check message is defined
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof ERROR_MESSAGES[code]).toBe("string");
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it("verifies no extraneous variants exist in TypeScript PaymentError", () => {
    const entries = parseRustErrors();
    const rustNames = new Set(entries.map((e) => e.name));
    const rustCodes = new Set(entries.map((e) => e.code));

    for (const [codeStr, name] of Object.entries(PAYMENT_ERROR_NAMES)) {
      const code = parseInt(codeStr, 10);
      expect(
        rustCodes.has(code),
        `TypeScript code ${code} does not exist in Rust enum`,
      ).toBe(true);
      expect(
        rustNames.has(name),
        `TypeScript name ${name} does not exist in Rust enum`,
      ).toBe(true);
    }
  });

  it("passes scripts/regenerate-errors.ts --check parity verification", () => {
    const result = checkParity();
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });
});
