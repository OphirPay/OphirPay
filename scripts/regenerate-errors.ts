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

import { ERROR_TAXONOMY, type ErrorTaxonomyEntry } from "./error-taxonomy";

export interface ClassifiedContractError extends ErrorTaxonomyEntry {
  contractCode?: string;
  rawError: string;
}

export const CONTRACT_ERROR_MAP: Record<string, string> = {
`;

  for (const { code, message } of entries) {
    newTs += `  "${code}": ${JSON.stringify(message)},\n`;
  }

  newTs += `};

const CONTRACT_CODE_TO_TAXONOMY: Record<string, { code: string; status?: number }> = {
  "1": { code: "INTERNAL_ERROR", status: 500 },
  "2": { code: "CONFLICT", status: 409 },
  "3": { code: "PAYMENT_NOT_FOUND", status: 404 },
  "4": { code: "UNAUTHORIZED", status: 401 },
  "5": { code: "INVALID_AMOUNT", status: 400 },
  "6": { code: "BAD_REQUEST", status: 400 },
  "7": { code: "CONFLICT", status: 409 },
  "8": { code: "ESCROW_NOT_FOUND", status: 404 },
  "9": { code: "BAD_REQUEST", status: 400 },
  "10": { code: "CONFLICT", status: 409 },
  "11": { code: "STREAM_NOT_FOUND", status: 404 },
  "12": { code: "CONFLICT", status: 409 },
  "13": { code: "BATCH_TOO_LARGE", status: 413 },
  "14": { code: "BAD_REQUEST", status: 400 },
  "15": { code: "PAYMENT_FAILED", status: 500 },
  "16": { code: "INSUFFICIENT_FUNDS", status: 402 },
  "17": { code: "CONFLICT", status: 409 },
  "18": { code: "MAINTENANCE_MODE", status: 503 },
  "21": { code: "CONFLICT", status: 409 },
  "22": { code: "MULTISIG_NOT_CONFIGURED", status: 500 },
  "23": { code: "FORBIDDEN", status: 403 },
  "24": { code: "ALREADY_APPROVED", status: 409 },
  "25": { code: "THRESHOLD_NOT_MET", status: 400 },
  "26": { code: "ALREADY_EXECUTED", status: 409 },
  "27": { code: "INSUFFICIENT_PERMISSIONS", status: 403 },
  "29": { code: "NOT_FOUND", status: 404 },
  "30": { code: "NOT_FOUND", status: 404 },
  "34": { code: "NOT_FOUND", status: 404 },
  "36": { code: "NOT_FOUND", status: 404 },
  "40": { code: "PROPOSAL_NOT_FOUND", status: 404 },
  "41": { code: "VOTING_ENDED", status: 400 },
  "42": { code: "PROPOSAL_ALREADY_EXECUTED", status: 409 },
  "43": { code: "QUORUM_NOT_MET", status: 400 },
  "47": { code: "NOT_FOUND", status: 404 },
  "48": { code: "CONFLICT", status: 409 },
  "49": { code: "CONFLICT", status: 409 },
  "51": { code: "ALREADY_VOTED", status: 409 },
  "55": { code: "NOT_FOUND", status: 404 },
  "62": { code: "NOT_FOUND", status: 404 },
  "63": { code: "CONFLICT", status: 409 },
  "64": { code: "RATE_LIMITED", status: 429 },
  "65": { code: "ASSET_NOT_SUPPORTED", status: 400 },
  "67": { code: "BATCH_TOO_LARGE", status: 413 },
  "68": { code: "DUPLICATE_REQUEST", status: 409 },
  "73": { code: "INVALID_ADDRESS", status: 400 },
  "79": { code: "SIGNER_LIMIT_EXCEEDED", status: 400 },
  "84": { code: "PAYLOAD_TOO_LARGE", status: 413 },
  "104": { code: "MAINTENANCE_MODE", status: 503 },
  "111": { code: "MAINTENANCE_MODE", status: 503 },
  "129": { code: "MAINTENANCE_MODE", status: 503 },
  "150": { code: "SERVICE_UNAVAILABLE", status: 503 },
  "163": { code: "DEPENDENCY_UNAVAILABLE", status: 503 },
  "288": { code: "DEPENDENCY_UNAVAILABLE", status: 503 },
  "291": { code: "MAINTENANCE_MODE", status: 503 },
  "293": { code: "MAINTENANCE_MODE", status: 503 },
  "301": { code: "NOT_FOUND", status: 404 },
  "302": { code: "BAD_REQUEST", status: 400 },
  "303": { code: "ALREADY_EXECUTED", status: 409 },
  "304": { code: "FORBIDDEN", status: 403 },
  "305": { code: "NOT_FOUND", status: 404 },
  "306": { code: "BAD_REQUEST", status: 400 },
  "307": { code: "CONFLICT", status: 409 },
};

/**
 * Classify a Soroban contract error into a structured taxonomy entry.
 */
export function parseContractError(rawError: string | number): ClassifiedContractError {
  const str = String(rawError).trim();
  const codeMatch = str.match(/Error\\(Contract,\\s*#(\\d+)\\)/);
  const codeNum = codeMatch ? codeMatch[1] : (CONTRACT_ERROR_MAP[str] ? str : undefined);

  if (codeNum && CONTRACT_ERROR_MAP[codeNum]) {
    const message = CONTRACT_ERROR_MAP[codeNum];
    const mapping = CONTRACT_CODE_TO_TAXONOMY[codeNum];
    const taxonomyCode = mapping?.code || "CONTRACT_ERROR";
    const baseEntry =
      ERROR_TAXONOMY[taxonomyCode as keyof typeof ERROR_TAXONOMY] ||
      ERROR_TAXONOMY.CONTRACT_ERROR;

    return {
      code: baseEntry.code,
      status: mapping?.status ?? baseEntry.status,
      message,
      contractCode: codeNum,
      rawError: str,
      category: "contract",
    };
  }

  const fallback = ERROR_TAXONOMY.CONTRACT_ERROR;
  return {
    ...fallback,
    rawError: str,
    message: str || fallback.message,
    category: "contract",
  };
}

/**
 * Attempt to decode a Soroban contract error from a diagnostic event
 * or raw error value. Falls back to the raw value if unknown.
 */
export function decodeContractError(rawError: string): string {
  if (!rawError) return "";
  return parseContractError(rawError).message;
}

/**
 * Get all known contract errors for documentation / tooltips with taxonomy mappings.
 */
export function getContractErrorCatalog(): {
  code: string;
  message: string;
  taxonomyCode: string;
  status: number;
}[] {
  return Object.entries(CONTRACT_ERROR_MAP)
    .map(([code, message]) => {
      const parsed = parseContractError(code);
      return {
        code,
        message,
        taxonomyCode: parsed.code,
        status: parsed.status,
      };
    })
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
