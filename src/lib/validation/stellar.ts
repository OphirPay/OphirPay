// SPDX-License-Identifier: MIT

/**
 * Stellar transaction memo encoding and character set validation.
 *
 * Enforces Stellar network memo constraints:
 * - MEMO_TEXT: up to 28 UTF-8 bytes (Buffer.byteLength(memo, 'utf8') <= 28), rejecting C0/C1 control characters.
 * - MEMO_ID: 64-bit unsigned integer (0 to 18446744073709551615).
 * - MEMO_HASH: 32-byte hash encoded as 64-character hexadecimal string.
 * - MEMO_RETURN: 32-byte hash encoded as 64-character hexadecimal string.
 */

import { z } from "zod";

export const STELLAR_MEMO_MAX_BYTES = 28;

// Control chars (C0/C1), zero-width and bidi isolates/overrides/embeddings.
// Covers: \u0000-\u001F \u007F-\u009F, ZWSP/ZWNJ/ZWJ/LRM/RLM (200B-200F),
// LRE/RLE/PDF/LRO/RLO (202A-202E), LRI/RLI/FSI/PDI (2066-2069).
export const STELLAR_MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

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

export type CanonicalStellarMemoType =
  | "MEMO_TEXT"
  | "MEMO_ID"
  | "MEMO_HASH"
  | "MEMO_RETURN";

export interface StellarMemoValidationResult {
  valid: boolean;
  type: CanonicalStellarMemoType;
  error?: string;
  byteLength?: number;
}

export const STELLAR_MEMO_ERROR_MESSAGES = {
  tooLong: "Memo must be 28 characters or fewer",
  tooManyBytes:
    "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
  controlChars: "Memo must not contain control or invisible characters",
  invalidId:
    "Memo ID must be a non-negative 64-bit unsigned integer string (0-18446744073709551615).",
  invalidHash:
    "Memo hash must be a 64-character hexadecimal string (32 bytes).",
  invalidReturn:
    "Memo return must be a 64-character hexadecimal string (32 bytes).",
  unsupportedType:
    "Unsupported memo type. Must be MEMO_TEXT, MEMO_ID, MEMO_HASH, or MEMO_RETURN.",
} as const;

/**
 * Normalize any supported memo type string to its canonical Stellar enum name.
 */
export function normalizeStellarMemoType(
  type?: string | null
): CanonicalStellarMemoType {
  if (!type) return "MEMO_TEXT";
  const normalized = type.trim().toUpperCase();
  if (normalized === "TEXT" || normalized === "MEMO_TEXT") return "MEMO_TEXT";
  if (normalized === "ID" || normalized === "MEMO_ID") return "MEMO_ID";
  if (normalized === "HASH" || normalized === "MEMO_HASH") return "MEMO_HASH";
  if (normalized === "RETURN" || normalized === "MEMO_RETURN") return "MEMO_RETURN";
  return "MEMO_TEXT";
}

/**
 * Calculates UTF-8 byte length using Node's Buffer.byteLength.
 */
export function getMemoByteLength(memo: string): number {
  return Buffer.byteLength(memo, "utf8");
}

/**
 * Validates a memo value against Stellar network rules and character set constraints.
 */
export function validateStellarMemo(
  memo?: string | null,
  type?: string | null
): StellarMemoValidationResult {
  const canonicalType = normalizeStellarMemoType(type);

  if (memo === undefined || memo === null || memo === "") {
    return { valid: true, type: canonicalType, byteLength: 0 };
  }

  // Type validation: check if explicit type passed is supported
  if (type) {
    const rawUpper = type.trim().toUpperCase();
    const validRaw = [
      "MEMO_TEXT",
      "TEXT",
      "MEMO_ID",
      "ID",
      "MEMO_HASH",
      "HASH",
      "MEMO_RETURN",
      "RETURN",
    ];
    if (!validRaw.includes(rawUpper)) {
      return {
        valid: false,
        type: canonicalType,
        error: `${STELLAR_MEMO_ERROR_MESSAGES.unsupportedType} (got: ${type})`,
      };
    }
  }

  if (canonicalType === "MEMO_ID") {
    const trimmed = memo.trim();
    if (!/^\d+$/.test(trimmed)) {
      return {
        valid: false,
        type: canonicalType,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidId,
      };
    }
    try {
      const val = BigInt(trimmed);
      const MAX_UINT64 = BigInt("18446744073709551615");
      const ZERO = BigInt("0");
      if (val < ZERO || val > MAX_UINT64) {
        return {
          valid: false,
          type: canonicalType,
          error: STELLAR_MEMO_ERROR_MESSAGES.invalidId,
        };
      }
    } catch {
      return {
        valid: false,
        type: canonicalType,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidId,
      };
    }
    return { valid: true, type: canonicalType };
  }

  if (canonicalType === "MEMO_HASH") {
    const trimmed = memo.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return {
        valid: false,
        type: canonicalType,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidHash,
      };
    }
    return { valid: true, type: canonicalType, byteLength: 32 };
  }

  if (canonicalType === "MEMO_RETURN") {
    const trimmed = memo.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return {
        valid: false,
        type: canonicalType,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidReturn,
      };
    }
    return { valid: true, type: canonicalType, byteLength: 32 };
  }

  // Canonical MEMO_TEXT
  if (STELLAR_MEMO_CONTROL_CHARS.test(memo)) {
    return {
      valid: false,
      type: canonicalType,
      error: STELLAR_MEMO_ERROR_MESSAGES.controlChars,
    };
  }

  const byteLength = Buffer.byteLength(memo, "utf8");

  if (memo.length > STELLAR_MEMO_MAX_BYTES) {
    return {
      valid: false,
      type: canonicalType,
      byteLength,
      error: STELLAR_MEMO_ERROR_MESSAGES.tooLong,
    };
  }

  if (byteLength > STELLAR_MEMO_MAX_BYTES) {
    return {
      valid: false,
      type: canonicalType,
      byteLength,
      error: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
    };
  }

  return { valid: true, type: canonicalType, byteLength };
}

// ── Zod Schemas & Refinements ─────────────────────────────────

export const stellarMemoTypeSchema = z.enum(STELLAR_MEMO_TYPES);

/**
 * Standard Zod refinement for a text memo string checking character count,
 * control characters, and UTF-8 byte length (Buffer.byteLength(memo, 'utf8') <= 28).
 */
export const stellarMemoSchema = z
  .string()
  .trim()
  .refine((val) => !STELLAR_MEMO_CONTROL_CHARS.test(val), {
    message: STELLAR_MEMO_ERROR_MESSAGES.controlChars,
  })
  .refine((val) => val.length <= STELLAR_MEMO_MAX_BYTES, {
    message: STELLAR_MEMO_ERROR_MESSAGES.tooLong,
  })
  .refine((val) => Buffer.byteLength(val, "utf8") <= STELLAR_MEMO_MAX_BYTES, {
    message: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
  });

/**
 * Type-aware Zod superRefine helper for payloads with optional `memo` and `memoType`.
 */
export function refineStellarMemo<
  T extends { memo?: string | null; memoType?: string | null }
>(data: T, ctx: z.RefinementCtx): void {
  if (data.memo === undefined || data.memo === null || data.memo === "") {
    return;
  }
  const result = validateStellarMemo(data.memo, data.memoType);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["memo"],
      message: result.error ?? "Invalid Stellar memo",
    });
  }
}
