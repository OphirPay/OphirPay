// SPDX-License-Identifier: MIT
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rustPath = path.join(__dirname, "../contracts/ophirpay/src/errors.rs");
const contractErrorsTsPath = path.join(__dirname, "../src/lib/contract-errors.ts");
const typesErrorsTsPath = path.join(__dirname, "../src/types/errors.ts");

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

  // Validate uniqueness of discriminants
  const codeToName = new Map<number, string>();
  for (const entry of entries) {
    if (codeToName.has(entry.code)) {
      throw new Error(
        `Duplicate discriminant ${entry.code} found for '${codeToName.get(entry.code)}' and '${entry.name}'`,
      );
    }
    codeToName.set(entry.code, entry.name);
  }

  return entries;
}

export function generateCatalog(): string {
  const entries = parseRustErrors();
  return generateContractErrors(entries);
}

export function generateContractErrors(entries: ErrorEntry[]): string {
  let ts = `// SPDX-License-Identifier: MIT
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
    ts += `  "${code}": ${JSON.stringify(message)},\n`;
  }

  ts += `};

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
  return ts;
}

export function generateTypesErrors(entries: ErrorEntry[]): string {
  let ts = `// SPDX-License-Identifier: MIT
// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run \`npm run generate-errors\` to update.

/**
 * Soroban contract PaymentError enum catalog (#1411).
 * Mirrors the PaymentError enum in contracts/ophirpay/src/errors.rs with 100% parity.
 */
export enum PaymentError {
`;

  for (const { name, code } of entries) {
    ts += `  ${name} = ${code},\n`;
  }

  ts += `}

export const PAYMENT_ERROR_NAMES: Record<number, string> = {
`;
  for (const { name, code } of entries) {
    ts += `  ${code}: ${JSON.stringify(name)},\n`;
  }

  ts += `};

export const PAYMENT_ERROR_DISCRIMINANTS: Record<string, number> = {
`;
  for (const { name, code } of entries) {
    ts += `  ${JSON.stringify(name)}: ${code},\n`;
  }

  ts += `};

export const ERROR_MESSAGES: Record<number, string> = {
`;
  for (const { code, message } of entries) {
    ts += `  ${code}: ${JSON.stringify(message)},\n`;
  }

  ts += `};
`;
  return ts;
}

export function checkParity(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  let entries: ErrorEntry[];
  try {
    entries = parseRustErrors();
  } catch (err: unknown) {
    errors.push(`Failed to parse Rust errors: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, errors };
  }

  const expectedContractErrors = generateContractErrors(entries);
  const expectedTypesErrors = generateTypesErrors(entries);

  if (!fs.existsSync(contractErrorsTsPath)) {
    errors.push(`Missing ${contractErrorsTsPath}`);
  } else {
    const actualContractErrors = fs.readFileSync(contractErrorsTsPath, "utf8");
    if (actualContractErrors.trim() !== expectedContractErrors.trim()) {
      errors.push(`src/lib/contract-errors.ts is out of sync with contracts/ophirpay/src/errors.rs`);
    }
  }

  if (!fs.existsSync(typesErrorsTsPath)) {
    errors.push(`Missing ${typesErrorsTsPath}`);
  } else {
    const actualTypesErrors = fs.readFileSync(typesErrorsTsPath, "utf8");
    if (actualTypesErrors.trim() !== expectedTypesErrors.trim()) {
      errors.push(`src/types/errors.ts is out of sync with contracts/ophirpay/src/errors.rs`);
    }
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] === __filename) {
  const isCheckMode = process.argv.includes("--check");

  if (isCheckMode) {
    const { ok, errors } = checkParity();
    if (!ok) {
      console.error("❌ Error catalog parity check failed:\n");
      for (const err of errors) {
        console.error(`- ${err}`);
      }
      console.error("\nRun `npm run generate-errors` to update TypeScript catalogs.");
      process.exit(1);
    }
    console.log("✅ Error catalog is in 100% parity with Rust contract enum.");
    process.exit(0);
  }

  const entries = parseRustErrors();
  const contractErrorsContent = generateContractErrors(entries);
  const typesErrorsContent = generateTypesErrors(entries);

  fs.writeFileSync(contractErrorsTsPath, contractErrorsContent);
  fs.writeFileSync(typesErrorsTsPath, typesErrorsContent);

  console.log(`Successfully regenerated:`);
  console.log(`  - ${contractErrorsTsPath} (${entries.length} variants)`);
  console.log(`  - ${typesErrorsTsPath} (${entries.length} variants)`);
}
