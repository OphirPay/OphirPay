// SPDX-License-Identifier: MIT
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

export function generateTypesFile(entries: ErrorEntry[]): string {
  let content = `// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run \`npm run generate-errors\` to update.

/**
 * Soroban contract error codes and enumeration.
 * Mirrors the PaymentError enum in contracts/ophirpay/src/errors.rs.
 */
export enum ContractErrorCode {
`;

  for (const { name, code, message } of entries) {
    content += `  /** ${message} */\n`;
    content += `  ${name} = ${code},\n`;
  }

  content += `}

export type ContractErrorCodeName = keyof typeof ContractErrorCode;

export interface ContractErrorInfo {
  name: string;
  code: number;
  message: string;
}

/**
 * Mapping of numeric error code to variant name.
 */
export const CONTRACT_ERROR_NAMES: Record<number, string> = {
`;

  for (const { name, code } of entries) {
    content += `  ${code}: "${name}",\n`;
  }

  content += `};

/**
 * Mapping of numeric error code to human-readable message.
 */
export const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
`;

  for (const { code, message } of entries) {
    content += `  ${code}: ${JSON.stringify(message)},\n`;
  }

  content += `};

/**
 * Complete list of all contract error entries in numeric order.
 */
export const ALL_CONTRACT_ERRORS: ContractErrorInfo[] = [
`;

  for (const { name, code, message } of entries) {
    content += `  { name: "${name}", code: ${code}, message: ${JSON.stringify(message)} },\n`;
  }

  content += `];
`;

  return content;
}

export function generateCatalog(): string {
  const entries = parseRustErrors();

  let newTs = `// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run \`npm run generate-errors\` to update.

/**
 * Soroban contract error decoding utilities.
 * Maps raw contract error codes to human-readable messages.
 * Mirrors the PaymentError enum in contracts/ophirpay/src/errors.rs.
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
    .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));
}
`;
  return newTs;
}

export interface ParityCheckResult {
  valid: boolean;
  errors: string[];
  totalVariants: number;
}

export function verifyCatalogParity(): ParityCheckResult {
  const errors: string[] = [];
  const entries = parseRustErrors();

  if (entries.length === 0) {
    return {
      valid: false,
      errors: ["No error variants found in contracts/ophirpay/src/errors.rs"],
      totalVariants: 0,
    };
  }

  // 1. Discriminant uniqueness check
  const seenCodes = new Map<number, string>();
  for (const { name, code } of entries) {
    if (seenCodes.has(code)) {
      errors.push(
        `Duplicate discriminant ${code} between variants '${seenCodes.get(code)}' and '${name}'`
      );
    } else {
      seenCodes.set(code, name);
    }
  }

  // 2. Discriminants contiguous from 1..N
  const sortedCodes = entries.map((e) => e.code).sort((a, b) => a - b);
  const minCode = sortedCodes[0];
  const maxCode = sortedCodes[sortedCodes.length - 1];

  if (minCode !== 1) {
    errors.push(`Expected minimum error discriminant to be 1, found ${minCode}`);
  }
  if (maxCode !== entries.length) {
    errors.push(
      `Expected maximum error discriminant to be ${entries.length}, found ${maxCode} (possible gaps or skips)`
    );
  }

  // 3. Verify TypeScript files exist and match
  if (!fs.existsSync(tsTypesPath)) {
    errors.push(`src/types/errors.ts does not exist. Run npm run generate-errors.`);
  } else {
    const typesContent = fs.readFileSync(tsTypesPath, "utf8");
    for (const { name, code } of entries) {
      if (!typesContent.includes(`${name} = ${code},`)) {
        errors.push(`src/types/errors.ts is missing enum member ${name} = ${code}`);
      }
    }
  }

  if (!fs.existsSync(tsLibPath)) {
    errors.push(`src/lib/contract-errors.ts does not exist. Run npm run generate-errors.`);
  } else {
    const libContent = fs.readFileSync(tsLibPath, "utf8");
    for (const { code, message } of entries) {
      const expectedLine = `"${code}": ${JSON.stringify(message)}`;
      if (!libContent.includes(expectedLine)) {
        errors.push(`src/lib/contract-errors.ts is missing entry for code ${code}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    totalVariants: entries.length,
  };
}

if (process.argv[1] === __filename) {
  const isCheckMode = process.argv.includes("--check");

  if (isCheckMode) {
    const result = verifyCatalogParity();
    if (!result.valid) {
      console.error("❌ Error catalog parity check FAILED:");
      for (const err of result.errors) {
        console.error("  - " + err);
      }
      process.exit(1);
    }
    console.log(
      `✅ Error catalog parity verified: 100% parity across all ${result.totalVariants} variants.`
    );
    process.exit(0);
  }

  // Generation mode
  const entries = parseRustErrors();
  const typesOutput = generateTypesFile(entries);
  fs.writeFileSync(tsTypesPath, typesOutput);
  console.log(`Successfully generated ${tsTypesPath} (${entries.length} variants)`);

  const libOutput = generateCatalog();
  fs.writeFileSync(tsLibPath, libOutput);
  console.log(`Successfully generated ${tsLibPath} (${entries.length} variants)`);

  // Verify parity after regeneration
  const parity = verifyCatalogParity();
  if (!parity.valid) {
    console.error("❌ Parity check failed after generation:", parity.errors);
    process.exit(1);
  }
  console.log(`✅ All ${parity.totalVariants} error variants verified in 100% parity.`);
}
