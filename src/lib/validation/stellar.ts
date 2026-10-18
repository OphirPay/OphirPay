// SPDX-License-Identifier: MIT

/**
 * Stellar transaction memo validation schema and utilities (issue #1368).
 * Supports all four Stellar memo types: MEMO_TEXT, MEMO_ID, MEMO_HASH, and MEMO_RETURN.
 * Enforces UTF-8 byte counting via Buffer.byteLength, 64-bit unsigned int bounds,
 * 64-character hex format, and control character filtering.
 */

import { z } from "zod";

export const STELLAR_MEMO_TYPES = [
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
  "text",
  "id",
  "hash",
  "return",
] as const;

export type StellarMemoType = (typeof STELLAR_MEMO_TYPES)[number];

export const MEMO_TEXT_MAX_BYTES = 28;
export const MEMO_ID_MAX = BigInt("18446744073709551615"); // Max uint64: 2^64 - 1
export const MEMO_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

// Control chars (C0/C1), zero-width and bidi isolates/overrides/embeddings.
export const MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

export const STELLAR_MEMO_ERROR_MESSAGES = {
  textTooLong: "MEMO_TEXT exceeds 28 UTF-8 bytes limit",
  textControlChars: "MEMO_TEXT contains invalid control or invisible characters",
  idInvalidFormat: "MEMO_ID must be a non-negative 64-bit unsigned integer string",
  idOverflow: "MEMO_ID exceeds maximum 64-bit integer (18446744073709551615)",
  hashInvalidLength: "MEMO_HASH must be a 64-character hex-encoded string (32 bytes)",
  returnInvalidLength: "MEMO_RETURN must be a 64-character hex-encoded string (32 bytes)",
  invalidType: "Unsupported memo type specified",
} as const;

/**
 * Normalize memo type string to uppercase canonical form.
 */
export function normalizeMemoType(type: string = "MEMO_TEXT"): "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN" {
  const upper = type.toUpperCase().trim();
  if (upper === "TEXT" || upper === "MEMO_TEXT") return "MEMO_TEXT";
  if (upper === "ID" || upper === "MEMO_ID") return "MEMO_ID";
  if (upper === "HASH" || upper === "MEMO_HASH") return "MEMO_HASH";
  if (upper === "RETURN" || upper === "MEMO_RETURN") return "MEMO_RETURN";
  return "MEMO_TEXT";
}

/**
 * Validate a Stellar memo according to its explicit type.
 */
export function validateStellarMemo(
  memo: string,
  type: string = "MEMO_TEXT"
): { valid: boolean; error?: string; byteLength?: number } {
  if (!memo) {
    return { valid: true };
  }

  const canonicalType = normalizeMemoType(type);

  if (canonicalType === "MEMO_TEXT") {
    // 1. Control character rejection
    if (MEMO_CONTROL_CHARS.test(memo)) {
      return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.textControlChars };
    }

    // 2. Exact UTF-8 byte counting (issue #1368 requirement)
    const byteLength = Buffer.byteLength(memo, "utf8");
    if (byteLength > MEMO_TEXT_MAX_BYTES) {
      return {
        valid: false,
        byteLength,
        error: `${STELLAR_MEMO_ERROR_MESSAGES.textTooLong} (received ${byteLength} bytes)`,
      };
    }

    return { valid: true, byteLength };
  }

  if (canonicalType === "MEMO_ID") {
    const trimmed = memo.trim();
    if (!/^\d+$/.test(trimmed)) {
      return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.idInvalidFormat };
    }

    try {
      const val = BigInt(trimmed);
      if (val < BigInt(0) || val > MEMO_ID_MAX) {
        return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.idOverflow };
      }
    } catch {
      return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.idInvalidFormat };
    }

    return { valid: true };
  }

  if (canonicalType === "MEMO_HASH") {
    const trimmed = memo.trim();
    if (!MEMO_HEX_REGEX.test(trimmed)) {
      return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.hashInvalidLength };
    }
    return { valid: true };
  }

  if (canonicalType === "MEMO_RETURN") {
    const trimmed = memo.trim();
    if (!MEMO_HEX_REGEX.test(trimmed)) {
      return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.returnInvalidLength };
    }
    return { valid: true };
  }

  return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.invalidType };
}

/**
 * Zod schema refinement for Stellar memo string and optional memoType.
 */
export const stellarMemoField = z
  .string()
  .trim()
  .refine(
    (val) => {
      // If it looks like a 64-char hex, allow it as hash/return
      if (MEMO_HEX_REGEX.test(val)) return true;
      // If it's a numeric ID, check uint64 bounds
      if (/^\d+$/.test(val)) {
        try {
          const id = BigInt(val);
          if (id >= BigInt(0) && id <= MEMO_ID_MAX) return true;
        } catch {
          // Fall through to text check
        }
      }
      // Otherwise treat as MEMO_TEXT: check controls and UTF-8 byte length
      if (MEMO_CONTROL_CHARS.test(val)) return false;
      return Buffer.byteLength(val, "utf8") <= MEMO_TEXT_MAX_BYTES;
    },
    {
      message: STELLAR_MEMO_ERROR_MESSAGES.textTooLong,
    }
  )
  .optional();

/**
 * Structured memo object schema validating `{ memo?: string; memoType?: string }`.
 */
export const stellarMemoSchema = z
  .object({
    memo: z.string().optional(),
    memoType: z.enum(STELLAR_MEMO_TYPES).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.memo) return;
    const res = validateStellarMemo(data.memo, data.memoType ?? "MEMO_TEXT");
    if (!res.valid && res.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo"],
        message: res.error,
      });
    }
  });
