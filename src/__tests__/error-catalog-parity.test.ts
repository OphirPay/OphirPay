// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseRustErrors,
  verifyCatalogParity,
} from "../../scripts/regenerate-errors";
import {
  ContractErrorCode,
  CONTRACT_ERROR_NAMES,
  CONTRACT_ERROR_MESSAGES,
  ALL_CONTRACT_ERRORS,
} from "@/types/errors";
import {
  CONTRACT_ERROR_MAP,
  decodeContractError,
  getContractErrorCatalog,
} from "@/lib/contract-errors";

const RUST_ERRORS_PATH = path.resolve(
  process.cwd(),
  "contracts/ophirpay/src/errors.rs"
);

describe("Error Catalog Parity & Discriminant Uniqueness (Issue #1411)", () => {
  it("verifies contracts/ophirpay/src/errors.rs exists and has variants", () => {
    expect(fs.existsSync(RUST_ERRORS_PATH)).toBe(true);
    const rustEntries = parseRustErrors();
    expect(rustEntries.length).toBeGreaterThanOrEqual(309);
  });

  it("verifies every contract error discriminant is unique with no duplicates", () => {
    const rustEntries = parseRustErrors();
    const seenCodes = new Map<number, string>();
    const duplicates: string[] = [];

    for (const { name, code } of rustEntries) {
      if (seenCodes.has(code)) {
        duplicates.push(
          `Code ${code} used by both '${seenCodes.get(code)}' and '${name}'`
        );
      } else {
        seenCodes.set(code, name);
      }
    }

    expect(duplicates).toEqual([]);
    expect(seenCodes.size).toBe(rustEntries.length);
  });

  it("verifies discriminants are strictly contiguous from 1 to max", () => {
    const rustEntries = parseRustErrors();
    const codes = rustEntries.map((e) => e.code).sort((a, b) => a - b);
    const min = codes[0];
    const max = codes[codes.length - 1];

    expect(min).toBe(1);
    expect(max).toBe(rustEntries.length);
    for (let i = 0; i < codes.length; i++) {
      expect(codes[i]).toBe(i + 1);
    }
  });

  it("verifies 100% 1:1 parity between Rust PaymentError and TypeScript ContractErrorCode", () => {
    const rustEntries = parseRustErrors();

    // 1. Verify every Rust entry is present in ContractErrorCode enum
    for (const { name, code } of rustEntries) {
      // Enum mapping in TS: ContractErrorCode[name] === code and ContractErrorCode[code] === name
      expect((ContractErrorCode as Record<string, unknown>)[name]).toBe(code);
      expect((ContractErrorCode as Record<number, unknown>)[code]).toBe(name);

      // Names map
      expect(CONTRACT_ERROR_NAMES[code]).toBe(name);

      // Messages map
      expect(typeof CONTRACT_ERROR_MESSAGES[code]).toBe("string");
      expect(CONTRACT_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }

    // 2. Verify ALL_CONTRACT_ERRORS matches exactly
    expect(ALL_CONTRACT_ERRORS.length).toBe(rustEntries.length);
    for (let i = 0; i < rustEntries.length; i++) {
      expect(ALL_CONTRACT_ERRORS[i].name).toBe(rustEntries[i].name);
      expect(ALL_CONTRACT_ERRORS[i].code).toBe(rustEntries[i].code);
      expect(ALL_CONTRACT_ERRORS[i].message).toBe(rustEntries[i].message);
    }
  });

  it("verifies CONTRACT_ERROR_MAP and decodeContractError in contract-errors.ts", () => {
    const rustEntries = parseRustErrors();

    expect(Object.keys(CONTRACT_ERROR_MAP).length).toBe(rustEntries.length);

    for (const { code, message } of rustEntries) {
      expect(CONTRACT_ERROR_MAP[String(code)]).toBe(message);
    }

    // Decoding diagnostic event format: Error(Contract, #1)
    expect(decodeContractError("Error(Contract, #1)")).toBe(
      CONTRACT_ERROR_MAP["1"]
    );
    expect(decodeContractError("Error(Contract, #3)")).toBe(
      CONTRACT_ERROR_MAP["3"]
    );

    // Decoding numeric code
    expect(decodeContractError("1")).toBe(CONTRACT_ERROR_MAP["1"]);

    // Unknown error fallback
    expect(decodeContractError("Error(Contract, #999999)")).toBe(
      "Error(Contract, #999999)"
    );
    expect(decodeContractError("RandomUnknownError")).toBe("RandomUnknownError");

    // Catalog getter
    const catalog = getContractErrorCatalog();
    expect(catalog.length).toBe(rustEntries.length);
    expect(catalog[0].code).toBe("1");
    expect(catalog[catalog.length - 1].code).toBe(String(rustEntries.length));
  });

  it("verifies verifyCatalogParity tool passes with 0 errors", () => {
    const parity = verifyCatalogParity();
    expect(parity.valid).toBe(true);
    expect(parity.errors).toEqual([]);
    expect(parity.totalVariants).toBeGreaterThanOrEqual(309);
  });
});
