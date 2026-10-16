#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Regenerate and verify parity of contract error catalogs with Rust source:
// - src/lib/contract-errors.ts (runtime error decoding and map)
// - src/types/errors.ts (TypeScript enum and type definitions)
//
// Usage:
//   node scripts/regenerate-errors.mjs          # write the generated files
//   node scripts/regenerate-errors.mjs --check  # fail if committed files are stale or drift

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RUST_PATH = join(ROOT, "contracts", "ophirpay", "src", "errors.rs");
const TS_LIB_PATH = join(ROOT, "src", "lib", "contract-errors.ts");
const TS_TYPES_PATH = join(ROOT, "src", "types", "errors.ts");

/**
 * @typedef {Object} ErrorEntry
 * @property {string} name
 * @property {number} code
 * @property {string} message
 */

/**
 * @returns {ErrorEntry[]}
 */
export function parseRustErrors() {
  const rs = readFileSync(RUST_PATH, "utf8");
  let inEnum = false;
  /** @type {ErrorEntry[]} */
  const entries = [];
  let currentDoc = "";

  const lines = rs.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes("pub enum PaymentError {")) {
      inEnum = true;
      continue;
    }
    if (inEnum && line.trim() === "}") {
      break;
    }

    if (inEnum) {
      const docMatch = line.match(/^\s*\/\/\/\s*(.+)$/);
      if (docMatch) {
        currentDoc = docMatch[1].trim();
        continue;
      }

      const variantMatch = line.match(/^\s*(\w+)\s*=\s*(\d+),?/);
      if (variantMatch) {
        const name = variantMatch[1];
        const code = parseInt(variantMatch[2], 10);
        const message = currentDoc || name;
        entries.push({ name, code, message });
        currentDoc = "";
      }
    }
  }

  // Validate uniqueness
  const seen = new Map();
  for (const entry of entries) {
    if (seen.has(entry.code)) {
      throw new Error(
        `Duplicate discriminant code ${entry.code} in Rust source: '${seen.get(entry.code)}' and '${entry.name}'`
      );
    }
    seen.set(entry.code, entry.name);
  }

  return entries;
}

/**
 * @param {ErrorEntry[]} entries
 * @returns {string}
 */
export function generateContractErrorsTs(entries) {
  let content = `// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run \`npm run generate-errors\` to update.

/**
 * Soroban contract error decoding utilities.
 * Maps raw contract error codes to human-readable messages.
 * Mirrors the PaymentError enum in contracts/ophirpay/src/lib.rs.
 */

export const CONTRACT_ERROR_MAP: Record<string, string> = {
`;

  for (const { code, message } of entries) {
    content += `  "${code}": ${JSON.stringify(message)},\n`;
  }

  content += `};

/**
 * Attempt to decode a Soroban contract error from a diagnostic event
 * or raw error value. Falls back to the raw value if unknown.
 */
export function decodeContractError(rawError: string): string {
  const trimmed = rawError.trim();

  // Check for Error(Contract, #N) pattern
  const codeMatch = trimmed.match(/Error\\(Contract,\\s*#(\\d+)\\)/);
  if (codeMatch && CONTRACT_ERROR_MAP[codeMatch[1]]) {
    return CONTRACT_ERROR_MAP[codeMatch[1]];
  }

  // Check for numeric error codes from diagnostic events
  if (CONTRACT_ERROR_MAP[trimmed]) {
    return CONTRACT_ERROR_MAP[trimmed];
  }

  // Return raw error if we can't decode it
  return rawError;
}

/**
 * Get all known contract errors for documentation / tooltips.
 */
export function getContractErrorCatalog(): { code: string; message: string }[] {
  return Object.entries(CONTRACT_ERROR_MAP)
    .map(([code, message]) => ({ code, message }))
    .sort((a, b) => parseInt(a.code) - parseInt(b.code));
}
`;

  return content;
}

/**
 * @param {ErrorEntry[]} entries
 * @returns {string}
 */
export function generateTypesErrorsTs(entries) {
  let content = `// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run \`npm run generate-errors\` to update.

/**
 * Soroban contract error type definitions and TypeScript enum mirroring.
 * 1:1 mirroring of PaymentError in contracts/ophirpay/src/errors.rs.
 */

export enum PaymentErrorCode {
`;

  for (const { name, code, message } of entries) {
    content += `  /** ${message} */\n`;
    content += `  ${name} = ${code},\n`;
  }

  content += `}

export type PaymentErrorName =
`;

  for (const { name } of entries) {
    content += `  | "${name}"\n`;
  }

  content += `;

export interface PaymentErrorDefinition {
  code: PaymentErrorCode;
  name: PaymentErrorName;
  message: string;
}

export const PAYMENT_ERROR_DEFINITIONS: Record<number, PaymentErrorDefinition> = {
`;

  for (const { name, message } of entries) {
    content += `  [PaymentErrorCode.${name}]: {\n`;
    content += `    code: PaymentErrorCode.${name},\n`;
    content += `    name: "${name}",\n`;
    content += `    message: ${JSON.stringify(message)},\n`;
    content += `  },\n`;
  }

  content += `};

export const PAYMENT_ERROR_NAMES: readonly PaymentErrorName[] = [
`;

  for (const { name } of entries) {
    content += `  "${name}",\n`;
  }

  content += `] as const;

export function getPaymentErrorName(code: number): PaymentErrorName | undefined {
  return PAYMENT_ERROR_DEFINITIONS[code]?.name;
}

export function getPaymentErrorMessage(code: number): string | undefined {
  return PAYMENT_ERROR_DEFINITIONS[code]?.message;
}

export function isPaymentErrorCode(code: number): code is PaymentErrorCode {
  return code in PAYMENT_ERROR_DEFINITIONS;
}
`;

  return content;
}

export function checkParity() {
  const entries = parseRustErrors();
  const expectedLib = generateContractErrorsTs(entries);
  const expectedTypes = generateTypesErrorsTs(entries);

  /** @type {string[]} */
  const errors = [];

  let currentLib = "";
  try {
    currentLib = readFileSync(TS_LIB_PATH, "utf8");
  } catch (err) {
    errors.push(`Missing file: ${TS_LIB_PATH}`);
  }

  let currentTypes = "";
  try {
    currentTypes = readFileSync(TS_TYPES_PATH, "utf8");
  } catch (err) {
    errors.push(`Missing file: ${TS_TYPES_PATH}`);
  }

  if (currentLib !== expectedLib) {
    errors.push("src/lib/contract-errors.ts is out of date with contracts/ophirpay/src/errors.rs");
  }

  if (currentTypes !== expectedTypes) {
    errors.push("src/types/errors.ts is out of date with contracts/ophirpay/src/errors.rs");
  }

  return { isUpToDate: errors.length === 0, errors };
}

function run() {
  const isCheck = process.argv.includes("--check");
  const entries = parseRustErrors();

  if (isCheck) {
    const { isUpToDate, errors } = checkParity();
    if (!isUpToDate) {
      console.error("❌ Contract error parity check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
      console.error("\nRun `npm run generate-errors` to update the catalogs.");
      process.exit(1);
    }
    console.log(`✅ Contract error catalogues are up to date (${entries.length} variants in parity)`);
    process.exit(0);
  }

  const libOutput = generateContractErrorsTs(entries);
  const typesOutput = generateTypesErrorsTs(entries);

  writeFileSync(TS_LIB_PATH, libOutput, "utf8");
  writeFileSync(TS_TYPES_PATH, typesOutput, "utf8");

  console.log(`✅ Successfully regenerated:
  - ${TS_LIB_PATH}
  - ${TS_TYPES_PATH}
(${entries.length} variants synchronized)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
