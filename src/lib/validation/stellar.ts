// SPDX-License-Identifier: MIT
/**
 * Stellar memo validation schemas (issue #1368).
 *
 * Stellar Horizon supports four memo types:
 *   - MEMO_TEXT: up to 28 UTF-8 bytes
 *   - MEMO_ID: 64-bit unsigned integer (numeric string)
 *   - MEMO_HASH: 32-byte hex (64 hex characters)
 *   - MEMO_RETURN: 32-byte hex (64 hex characters)
 *
 * This module provides Zod refinements that validate format and byte length,
 * returning actionable error messages for each failure mode.
 */
import { z } from "zod";

export const MEMO_MAX_BYTES = 28;
export const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

// Control chars (C0/C1), zero-width and bidi isolates/overrides/embeddings.
const MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

export const MEMO_ERROR_MESSAGES = {
  tooLong: "Memo must be 28 characters or fewer",
  tooManyBytes:
    "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
  controlChars: "Memo must not contain control or invisible characters",
  invalidId: "Memo ID must be a non-negative 64-bit integer",
  invalidHash: "Memo hash must be a 64-character hex string",
  invalidReturn: "Memo return must be a 64-character hex string",
  invalidText: "Memo text contains invalid characters",
} as const;

export type StellarMemoType = "text" | "id" | "hash" | "return";

/**
 * Validate a text memo: printable UTF-8, max 28 bytes.
 */
function validateTextMemo(value: string): string | null {
  if (MEMO_CONTROL_CHARS.test(value)) {
    return MEMO_ERROR_MESSAGES.controlChars;
  }
  if (value.length > MEMO_MAX_BYTES) {
    return MEMO_ERROR_MESSAGES.tooLong;
  }
  if (new TextEncoder().encode(value).length > MEMO_MAX_BYTES) {
    return MEMO_ERROR_MESSAGES.tooManyBytes;
  }
  return null;
}

/**
 * Validate an ID memo: non-negative 64-bit integer.
 */
function validateIdMemo(value: string): string | null {
  if (!/^\d+$/.test(value)) {
    return MEMO_ERROR_MESSAGES.invalidId;
  }
  const num = BigInt(value);
  if (num > BigInt("18446744073709551615")) {
    return MEMO_ERROR_MESSAGES.invalidId;
  }
  return null;
}

/**
 * Validate a hash/return memo: 64-character hex string.
 */
function validateHashMemo(value: string, label: "hash" | "return"): string | null {
  if (!HEX_64_REGEX.test(value)) {
    return label === "hash"
      ? MEMO_ERROR_MESSAGES.invalidHash
      : MEMO_ERROR_MESSAGES.invalidReturn;
  }
  return null;
}

/**
 * Validate a memo value against a specific type.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateStellarMemo(
  value: string,
  type: StellarMemoType = "text",
): string | null {
  if (!value) return null;
  switch (type) {
    case "id":
      return validateIdMemo(value);
    case "hash":
      return validateHashMemo(value, "hash");
    case "return":
      return validateHashMemo(value, "return");
    case "text":
    default:
      return validateTextMemo(value);
  }
}

/**
 * Zod schema for a Stellar text memo (up to 28 UTF-8 bytes).
 */
export const stellarTextMemo = z
  .string()
  .trim()
  .refine((v) => !MEMO_CONTROL_CHARS.test(v), {
    message: MEMO_ERROR_MESSAGES.controlChars,
  })
  .refine((v) => v.length <= MEMO_MAX_BYTES, {
    message: MEMO_ERROR_MESSAGES.tooLong,
  })
  .refine((v) => new TextEncoder().encode(v).length <= MEMO_MAX_BYTES, {
    message: MEMO_ERROR_MESSAGES.tooManyBytes,
  })
  .optional();

/**
 * Zod schema for a Stellar ID memo (non-negative 64-bit integer).
 */
export const stellarIdMemo = z
  .string()
  .trim()
  .refine((v) => /^\d+$/.test(v), {
    message: MEMO_ERROR_MESSAGES.invalidId,
  })
  .refine(
    (v) => {
      try {
        return BigInt(v) <= BigInt("18446744073709551615");
      } catch {
        return false;
      }
    },
    { message: MEMO_ERROR_MESSAGES.invalidId },
  )
  .optional();

/**
 * Zod schema for a Stellar hash memo (64-character hex).
 */
export const stellarHashMemo = z
  .string()
  .trim()
  .refine((v) => HEX_64_REGEX.test(v), {
    message: MEMO_ERROR_MESSAGES.invalidHash,
  })
  .optional();

/**
 * Zod schema for a Stellar return memo (64-character hex).
 */
export const stellarReturnMemo = z
  .string()
  .trim()
  .refine((v) => HEX_64_REGEX.test(v), {
    message: MEMO_ERROR_MESSAGES.invalidReturn,
  })
  .optional();

/**
 * Union schema that auto-detects memo type and validates accordingly.
 */
export const stellarMemo = z
  .string()
  .trim()
  .refine((v) => {
    if (!v) return true;
    if (/^\d+$/.test(v)) {
      return validateIdMemo(v) === null;
    }
    if (HEX_64_REGEX.test(v)) {
      return true;
    }
    return validateTextMemo(v) === null;
  }, {
    message: "Invalid Stellar memo: must be valid text (≤28 bytes), id (uint64), or hash (64 hex chars)",
  })
  .optional();

/**
 * Discriminated union for explicit memo type selection.
 */
export const stellarMemoTyped = z
  .object({
    type: z.enum(["text", "id", "hash", "return"]),
    value: z.string(),
  })
  .refine((val) => {
    return validateStellarMemo(val.value, val.type) === null;
  }, {
    message: "Invalid Stellar memo for the specified type",
    path: ["value"],
  })
  .optional();
