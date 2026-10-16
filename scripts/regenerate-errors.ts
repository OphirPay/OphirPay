import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rustPath = path.join(__dirname, "../contracts/ophirpay/src/errors.rs");
const tsLibPath = path.join(__dirname, "../src/lib/contract-errors.ts");
const tsTypesPath = path.join(__dirname, "../src/types/errors.ts");

export interface ErrorEntry {
  name: string;
  code: number;
  message: string;
}

export function parseRustErrors(): ErrorEntry[] {
  const rs = fs.readFileSync(rustPath, "utf8");

  let inEnum = false;
  const entries: ErrorEntry[] = [];
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

  return entries;
}

export function generateCatalog(): string {
  const entries = parseRustErrors();

  let newTs = `// SPDX-License-Identifier: MIT
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
    newTs += `  "${code}": ${JSON.stringify(message)},\n`;
  }

  newTs += `};

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
  return newTs;
}

export function generateTypesCatalog(): string {
  const entries = parseRustErrors();

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

export function checkParity(): { isUpToDate: boolean; errors: string[] } {
  const expectedLib = generateCatalog();
  const expectedTypes = generateTypesCatalog();

  const errors: string[] = [];

  let currentLib = "";
  try {
    currentLib = fs.readFileSync(tsLibPath, "utf8");
  } catch (err) {
    errors.push(`Missing file: ${tsLibPath}`);
  }

  let currentTypes = "";
  try {
    currentTypes = fs.readFileSync(tsTypesPath, "utf8");
  } catch (err) {
    errors.push(`Missing file: ${tsTypesPath}`);
  }

  if (currentLib !== expectedLib) {
    errors.push("src/lib/contract-errors.ts is out of date with contracts/ophirpay/src/errors.rs");
  }

  if (currentTypes !== expectedTypes) {
    errors.push("src/types/errors.ts is out of date with contracts/ophirpay/src/errors.rs");
  }

  return { isUpToDate: errors.length === 0, errors };
}

if (process.argv[1] === __filename) {
  const isCheck = process.argv.includes("--check");
  if (isCheck) {
    const { isUpToDate, errors } = checkParity();
    if (!isUpToDate) {
      console.error("❌ Contract error parity check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
      process.exit(1);
    }
    console.log("✅ Contract error catalogues are up to date");
    process.exit(0);
  }

  const libOutput = generateCatalog();
  const typesOutput = generateTypesCatalog();
  fs.writeFileSync(tsLibPath, libOutput);
  fs.writeFileSync(tsTypesPath, typesOutput);
  console.log("Successfully regenerated src/lib/contract-errors.ts and src/types/errors.ts");
}
