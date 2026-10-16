// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * Stellar Transaction Memo Specifications & Validation
 *
 * Stellar Horizon supports 4 official memo types:
 * - MEMO_TEXT: UTF-8 encoded string up to 28 bytes.
 * - MEMO_ID: 64-bit unsigned integer (0 to 18446744073709551615).
 * - MEMO_HASH: 32-byte hash encoded as a 64-character hexadecimal string.
 * - MEMO_RETURN: 32-byte hash of the transaction to return (64-character hex string).
 */

export const STELLAR_MEMO_TYPES = [
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
] as const;

export type StellarMemoType = (typeof STELLAR_MEMO_TYPES)[number];

export const MEMO_MAX_BYTES = 28;
export const MEMO_HASH_HEX_LENGTH = 64; // 32 bytes in hex
export const MAX_UINT64 = BigInt("18446744073709551615");
export const ZERO_UINT64 = BigInt(0);

/**
 * Control characters (C0/C1), zero-width and bidi isolates/overrides/embeddings.
 * Rejects \u0000-\u001F, \u007F-\u009F, and invisible Unicode formatting chars.
 */
export const MEMO_CONTROL_CHARS_REGEX =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

export interface StellarMemoValidationResult {
  valid: boolean;
  type: StellarMemoType;
  error?: string;
  byteLength?: number;
}

/**
 * Validates a Stellar transaction memo according to its type.
 * Enforces UTF-8 byte counting via Buffer.byteLength, 64-bit range for IDs,
 * and 64-char hex format for hashes and returns.
 */
export function validateStellarMemo(
  memo: string | undefined | null,
  memoType: StellarMemoType | string = "MEMO_TEXT"
): StellarMemoValidationResult {
  if (memo === undefined || memo === null || memo === "") {
    return { valid: true, type: (memoType as StellarMemoType) || "MEMO_TEXT" };
  }

  const rawType = String(memoType).toUpperCase();
  const normalizedType: StellarMemoType = STELLAR_MEMO_TYPES.includes(rawType as StellarMemoType)
    ? (rawType as StellarMemoType)
    : rawType === "TEXT"
    ? "MEMO_TEXT"
    : rawType === "ID"
    ? "MEMO_ID"
    : rawType === "HASH"
    ? "MEMO_HASH"
    : rawType === "RETURN"
    ? "MEMO_RETURN"
    : (rawType as StellarMemoType);

  switch (normalizedType) {
    case "MEMO_TEXT": {
      if (MEMO_CONTROL_CHARS_REGEX.test(memo)) {
        return {
          valid: false,
          type: "MEMO_TEXT",
          error: "Memo text must not contain control or invisible characters",
        };
      }

      const byteLength = Buffer.byteLength(memo, "utf8");
      if (byteLength > MEMO_MAX_BYTES) {
        return {
          valid: false,
          type: "MEMO_TEXT",
          byteLength,
          error: `Memo text exceeds ${MEMO_MAX_BYTES} UTF-8 bytes limit (received ${byteLength} bytes)`,
        };
      }

      return { valid: true, type: "MEMO_TEXT", byteLength };
    }

    case "MEMO_ID": {
      const trimmed = memo.trim();
      if (!/^\d+$/.test(trimmed)) {
        return {
          valid: false,
          type: "MEMO_ID",
          error: "Memo ID must be a non-negative 64-bit integer string (digits only)",
        };
      }

      try {
        const val = BigInt(trimmed);
        if (val < ZERO_UINT64 || val > MAX_UINT64) {
          return {
            valid: false,
            type: "MEMO_ID",
            error: "Memo ID out of range (must be between 0 and 18446744073709551615)",
          };
        }
        return { valid: true, type: "MEMO_ID" };
      } catch {
        return {
          valid: false,
          type: "MEMO_ID",
          error: "Memo ID is not a valid 64-bit integer",
        };
      }
    }

    case "MEMO_HASH": {
      const trimmed = memo.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return {
          valid: false,
          type: "MEMO_HASH",
          error: `Memo hash must be a 64-character hexadecimal string (32 bytes), received ${trimmed.length} characters`,
        };
      }
      return { valid: true, type: "MEMO_HASH" };
    }

    case "MEMO_RETURN": {
      const trimmed = memo.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return {
          valid: false,
          type: "MEMO_RETURN",
          error: `Memo return must be a 64-character hexadecimal string (32 bytes), received ${trimmed.length} characters`,
        };
      }
      return { valid: true, type: "MEMO_RETURN" };
    }

    default:
      return {
        valid: false,
        type: "MEMO_TEXT",
        error: `Unsupported Stellar memo type: "${memoType}". Supported types: ${STELLAR_MEMO_TYPES.join(", ")}`,
      };
  }
}

/**
 * Zod schema refinement for Stellar memo validation.
 */
export const stellarMemoTypeSchema = z.enum(STELLAR_MEMO_TYPES);

/**
 * Zod refinement helper for objects with optional memo and memoType fields.
 */
export function refineStellarMemo<T extends { memo?: string | null; memoType?: string | null }>(
  data: T,
  ctx: z.RefinementCtx
): void {
  if (data.memo !== undefined && data.memo !== null && data.memo !== "") {
    const res = validateStellarMemo(data.memo, data.memoType || "MEMO_TEXT");
    if (!res.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: res.error || "Invalid Stellar memo",
        path: ["memo"],
      });
    }
  }
}

/**
 * Standalone Zod validator for a memo string (assumes MEMO_TEXT by default).
 */
export const stellarTextMemoSchema = z
  .string()
  .refine(
    (v: string) => !MEMO_CONTROL_CHARS_REGEX.test(v),
    { message: "Memo text must not contain control or invisible characters" }
  )
  .refine(
    (v: string) => Buffer.byteLength(v, "utf8") <= MEMO_MAX_BYTES,
    { message: `Memo text exceeds ${MEMO_MAX_BYTES} UTF-8 bytes limit` }
  );
