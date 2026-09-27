import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rustPath = path.join(__dirname, "../contracts/ophirpay/src/lib.rs");
const tsPath = path.join(__dirname, "../src/lib/contract-errors.ts");

export function generateCatalog(): string {
  const rs = fs.readFileSync(rustPath, "utf8");

  let inEnum = false;
  const entries: { code: string; message: string }[] = [];
  let currentDoc = "";

  const lines = rs.split("\n");
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
        const code = variantMatch[2];
        const message = currentDoc || variantMatch[1];
        entries.push({ code, message });
        currentDoc = "";
      }
    }
  }

  // Generate the new TS file
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

if (process.argv[1] === __filename) {
  const output = generateCatalog();
  fs.writeFileSync(tsPath, output);
  console.log("Successfully regenerated src/lib/contract-errors.ts");
}
