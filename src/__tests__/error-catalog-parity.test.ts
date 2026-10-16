// SPDX-License-Identifier: MIT
//
// Issue #1411 — Assert 1:1 parity and uniqueness between Rust PaymentError enum
// (contracts/ophirpay/src/errors.rs), TypeScript type catalog (src/types/errors.ts),
// and runtime decoder (src/lib/contract-errors.ts).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRustErrors,
  checkParity,
  generateContractErrorsTs,
  generateTypesErrorsTs,
} from "../../scripts/regenerate-errors.mjs";
import {
  PaymentErrorCode,
  PAYMENT_ERROR_DEFINITIONS,
  PAYMENT_ERROR_NAMES,
  getPaymentErrorName,
  getPaymentErrorMessage,
  isPaymentErrorCode,
} from "../types/errors";
import {
  CONTRACT_ERROR_MAP,
  decodeContractError,
  getContractErrorCatalog,
} from "../lib/contract-errors";

const root = process.cwd();

describe("Contract Error Catalog Parity & Registry Uniqueness (#1411)", () => {
  const rustErrors = parseRustErrors();

  it("parses exactly 309 variants from contracts/ophirpay/src/errors.rs", () => {
    expect(rustErrors.length).toBe(309);
    expect(rustErrors[0].name).toBe("NotInitialized");
    expect(rustErrors[0].code).toBe(1);
    expect(rustErrors[rustErrors.length - 1].name).toBe("PaymentIdempotencyConflict");
    expect(rustErrors[rustErrors.length - 1].code).toBe(309);
  });

  it("ensures every contract error code has a strictly unique integer discriminant", () => {
    const seenCodes = new Set<number>();
    const duplicateCodes: number[] = [];

    for (const { code } of rustErrors) {
      if (seenCodes.has(code)) {
        duplicateCodes.push(code);
      }
      seenCodes.add(code);
    }

    expect(duplicateCodes).toEqual([]);
    expect(seenCodes.size).toBe(309);
  });

  it("ensures error codes form a contiguous 1..309 sequence", () => {
    const codes = rustErrors.map((e) => e.code);
    const minCode = Math.min(...codes);
    const maxCode = Math.max(...codes);

    expect(minCode).toBe(1);
    expect(maxCode).toBe(309);
    for (let i = 1; i <= 309; i++) {
      expect(codes.includes(i)).toBe(true);
    }
  });

  it("verifies 1:1 parity between Rust enum and TypeScript PaymentErrorCode enum", () => {
    for (const { name, code } of rustErrors) {
      // Name to code mapping
      expect(PaymentErrorCode[name as keyof typeof PaymentErrorCode]).toBe(code);
      // Code to name mapping (reverse lookup in TS numeric enum)
      expect(PaymentErrorCode[code]).toBe(name);
    }
  });

  it("verifies 1:1 parity between Rust enum and CONTRACT_ERROR_MAP", () => {
    const mapKeys = Object.keys(CONTRACT_ERROR_MAP);
    expect(mapKeys.length).toBe(309);

    for (const { code, message } of rustErrors) {
      expect(CONTRACT_ERROR_MAP[String(code)]).toBe(message);
    }
  });

  it("verifies PAYMENT_ERROR_DEFINITIONS contains all 309 variants with matching metadata", () => {
    const defKeys = Object.keys(PAYMENT_ERROR_DEFINITIONS);
    expect(defKeys.length).toBe(309);

    for (const { name, code, message } of rustErrors) {
      const def = PAYMENT_ERROR_DEFINITIONS[code];
      expect(def).toBeDefined();
      expect(def.code).toBe(code);
      expect(def.name).toBe(name);
      expect(def.message).toBe(message);
    }
  });

  it("verifies helper functions getPaymentErrorName and getPaymentErrorMessage", () => {
    expect(getPaymentErrorName(1)).toBe("NotInitialized");
    expect(getPaymentErrorMessage(1)).toBe("Contract not initialized: call init() first");

    expect(getPaymentErrorName(309)).toBe("PaymentIdempotencyConflict");
    expect(getPaymentErrorMessage(309)).toBe(
      "Idempotency key was reused for a different payment payload"
    );

    expect(getPaymentErrorName(9999)).toBeUndefined();
    expect(getPaymentErrorMessage(9999)).toBeUndefined();

    expect(isPaymentErrorCode(1)).toBe(true);
    expect(isPaymentErrorCode(309)).toBe(true);
    expect(isPaymentErrorCode(0)).toBe(false);
    expect(isPaymentErrorCode(310)).toBe(false);
  });

  it("verifies runtime decodeContractError decodes events and diagnostic patterns", () => {
    expect(decodeContractError("Error(Contract, #1)")).toBe(
      "Contract not initialized: call init() first"
    );
    expect(decodeContractError("Error(Contract, #4)")).toBe(
      "Unauthorized: caller does not have permission"
    );
    expect(decodeContractError("1")).toBe("Contract not initialized: call init() first");
    expect(decodeContractError("Unknown error occurred")).toBe("Unknown error occurred");
  });

  it("verifies getContractErrorCatalog returns all 309 errors sorted ascending by code", () => {
    const catalog = getContractErrorCatalog();
    expect(catalog.length).toBe(309);
    expect(catalog[0].code).toBe("1");
    expect(catalog[catalog.length - 1].code).toBe("309");

    for (let i = 0; i < catalog.length - 1; i++) {
      expect(parseInt(catalog[i].code, 10)).toBeLessThan(parseInt(catalog[i + 1].code, 10));
    }
  });

  it("verifies committed files are identical to regenerated output via checkParity", () => {
    const parity = checkParity();
    expect(parity.isUpToDate).toBe(true);
    expect(parity.errors).toEqual([]);

    const tsLib = readFileSync(join(root, "src/lib/contract-errors.ts"), "utf8");
    const tsTypes = readFileSync(join(root, "src/types/errors.ts"), "utf8");

    expect(tsLib).toBe(generateContractErrorsTs(rustErrors));
    expect(tsTypes).toBe(generateTypesErrorsTs(rustErrors));
  });
});
