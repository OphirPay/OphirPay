// SPDX-License-Identifier: MIT

import { z } from "zod";

/** Supported Stellar transaction memo types */
export const STELLAR_MEMO_TYPES = [
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
] as const;

export type StellarMemoType = (typeof STELLAR_MEMO_TYPES)[number];

export const STELLAR_MEMO_MAX_BYTES = 28;
export const STELLAR_MEMO_HASH_BYTES = 32;
export const STELLAR_MEMO_HASH_HEX_LENGTH = 64;

// Control chars (C0/C1), zero-width and bidi isolates/overrides/embeddings
export const STELLAR_MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

/** Client-facing error messages for memo validation */
export const STELLAR_MEMO_ERRORS = {
  tooLong: "Memo must be 28 characters or fewer",
  tooManyBytes:
    "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
  controlChars: "Memo must not contain control or invisible characters",
  invalidId: "Memo ID must be a non-negative 64-bit integer numeric string",
  invalidHash: "Memo hash must be a 64-character hex string (32 bytes)",
  invalidReturn: "Memo return must be a 64-character hex string (32 bytes)",
} as const;

/**
 * Calculates UTF-8 byte length using Buffer.byteLength.
 */
export function getMemoByteLength(memo: string): number {
  return Buffer.byteLength(memo, "utf8");
}

/**
 * Zod refinement function calculating byte length <= 28 for UTF-8 memos.
 */
export function validateMemoByteLength(memo: string): boolean {
  return getMemoByteLength(memo) <= STELLAR_MEMO_MAX_BYTES;
}

/**
 * Validates a memo value based on its explicit memo type.
 */
export function validateStellarMemoValue(
  value: string,
  type: StellarMemoType = "MEMO_TEXT"
): { valid: boolean; error?: string } {
  if (!value) return { valid: true };

  switch (type) {
    case "MEMO_TEXT": {
      if (STELLAR_MEMO_CONTROL_CHARS.test(value)) {
        return { valid: false, error: STELLAR_MEMO_ERRORS.controlChars };
      }
      if (value.length > STELLAR_MEMO_MAX_BYTES) {
        return { valid: false, error: STELLAR_MEMO_ERRORS.tooLong };
      }
      if (!validateMemoByteLength(value)) {
        return { valid: false, error: STELLAR_MEMO_ERRORS.tooManyBytes };
      }
      return { valid: true };
    }
    case "MEMO_ID": {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) {
        return { valid: false, error: STELLAR_MEMO_ERRORS.invalidId };
      }
      try {
        const id = BigInt(trimmed);
        if (id < BigInt(0) || id > BigInt("18446744073709551615")) {
          return { valid: false, error: STELLAR_MEMO_ERRORS.invalidId };
        }
      } catch {
        return { valid: false, error: STELLAR_MEMO_ERRORS.invalidId };
      }
      return { valid: true };
    }
    case "MEMO_HASH": {
      const trimmed = value.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return { valid: false, error: STELLAR_MEMO_ERRORS.invalidHash };
      }
      return { valid: true };
    }
    case "MEMO_RETURN": {
      const trimmed = value.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return { valid: false, error: STELLAR_MEMO_ERRORS.invalidReturn };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

/**
 * Zod refinement for text memo with UTF-8 byte counting and control character checks.
 */
export const stellarMemoTextSchema = z
  .string()
  .trim()
  .refine((v) => !STELLAR_MEMO_CONTROL_CHARS.test(v), {
    message: STELLAR_MEMO_ERRORS.controlChars,
  })
  .refine((v) => v.length <= STELLAR_MEMO_MAX_BYTES, {
    message: STELLAR_MEMO_ERRORS.tooLong,
  })
  .refine(validateMemoByteLength, {
    message: STELLAR_MEMO_ERRORS.tooManyBytes,
  });

/**
 * Zod schema for memo ID (64-bit unsigned integer).
 */
export const stellarMemoIdSchema = z
  .string()
  .trim()
  .refine(
    (v) => {
      if (!/^\d+$/.test(v)) return false;
      try {
        const id = BigInt(v);
        return id >= BigInt(0) && id <= BigInt("18446744073709551615");
      } catch {
        return false;
      }
    },
    {
      message: STELLAR_MEMO_ERRORS.invalidId,
    }
  );

/**
 * Zod schema for memo hash (32-byte hex string = 64 hex chars).
 */
export const stellarMemoHashSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{64}$/, {
    message: STELLAR_MEMO_ERRORS.invalidHash,
  });

/**
 * Zod schema for memo return (32-byte hex string = 64 hex chars).
 */
export const stellarMemoReturnSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{64}$/, {
    message: STELLAR_MEMO_ERRORS.invalidReturn,
  });

/**
 * Combined Zod schema for validating memo and memoType together.
 */
export const stellarMemoInputSchema = z
  .object({
    memo: z.string().optional(),
    memoType: z.enum(STELLAR_MEMO_TYPES).optional().default("MEMO_TEXT"),
  })
  .superRefine((data, ctx) => {
    if (!data.memo) return;
    const result = validateStellarMemoValue(data.memo, data.memoType);
    if (!result.valid && result.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo"],
        message: result.error,
      });
    }
  });

/**
 * Standalone optional memo field that enforces UTF-8 byte length refinement.
 * Backwards compatible drop-in replacement for memoField.
 */
export const stellarMemoField = z
  .string()
  .trim()
  .refine((v) => !STELLAR_MEMO_CONTROL_CHARS.test(v), {
    message: STELLAR_MEMO_ERRORS.controlChars,
  })
  .refine((v) => v.length <= STELLAR_MEMO_MAX_BYTES, {
    message: STELLAR_MEMO_ERRORS.tooLong,
  })
  .refine(validateMemoByteLength, {
    message: STELLAR_MEMO_ERRORS.tooManyBytes,
  })
  .optional();
