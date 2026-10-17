// SPDX-License-Identifier: MIT

import { z } from "zod";

export const STELLAR_MEMO_MAX_BYTES = 28;

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

export const stellarMemoTypeEnum = z.enum(STELLAR_MEMO_TYPES);

export const MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

export const MEMO_ERROR_MESSAGES = {
  tooLong: "Memo must be 28 characters or fewer",
  tooManyBytes:
    "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
  controlChars: "Memo must not contain control or invisible characters",
  invalidId: "Stellar memo ID must be a non-negative 64-bit integer",
  idOverflow: "Stellar memo ID exceeds maximum 64-bit unsigned integer (18446744073709551615)",
  invalidHash: "Stellar memo hash must be a 64-character hex-encoded string (32 bytes)",
  invalidReturn: "Stellar memo return must be a 64-character hex-encoded string (32 bytes)",
} as const;

export function normalizeMemoType(
  type?: string | null,
): "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN" {
  if (!type) return "MEMO_TEXT";
  const upper = type.toUpperCase();
  if (upper === "TEXT" || upper === "MEMO_TEXT") return "MEMO_TEXT";
  if (upper === "ID" || upper === "MEMO_ID") return "MEMO_ID";
  if (upper === "HASH" || upper === "MEMO_HASH") return "MEMO_HASH";
  if (upper === "RETURN" || upper === "MEMO_RETURN") return "MEMO_RETURN";
  return "MEMO_TEXT";
}

export interface StellarMemoValidationResult {
  valid: boolean;
  normalizedType: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
  byteLength: number;
  error?: string;
}

/**
 * Validates a Stellar memo according to the Stellar protocol specification.
 * - MEMO_TEXT: Max 28 UTF-8 bytes, no control or invisible characters.
 * - MEMO_ID: 64-bit unsigned integer (0 to 18,446,744,073,709,551,615).
 * - MEMO_HASH: 32 bytes encoded as 64 hex characters.
 * - MEMO_RETURN: 32 bytes encoded as 64 hex characters.
 */
export function validateStellarMemo(
  value: string,
  type?: StellarMemoType | string,
): StellarMemoValidationResult {
  const normalizedType = normalizeMemoType(type);
  const byteLength = Buffer.byteLength(value, "utf8");

  switch (normalizedType) {
    case "MEMO_TEXT": {
      if (MEMO_CONTROL_CHARS.test(value)) {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.controlChars,
        };
      }
      if (value.length > STELLAR_MEMO_MAX_BYTES) {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.tooLong,
        };
      }
      if (byteLength > STELLAR_MEMO_MAX_BYTES) {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.tooManyBytes,
        };
      }
      return { valid: true, normalizedType, byteLength };
    }

    case "MEMO_ID": {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.invalidId,
        };
      }
      try {
        const big = BigInt(trimmed);
        const MAX_U64 = BigInt("18446744073709551615"); // 2^64 - 1
        if (big < BigInt(0) || big > MAX_U64) {
          return {
            valid: false,
            normalizedType,
            byteLength,
            error: MEMO_ERROR_MESSAGES.idOverflow,
          };
        }
      } catch {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.invalidId,
        };
      }
      return { valid: true, normalizedType, byteLength };
    }

    case "MEMO_HASH": {
      const trimmed = value.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.invalidHash,
        };
      }
      return { valid: true, normalizedType, byteLength: 32 };
    }

    case "MEMO_RETURN": {
      const trimmed = value.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return {
          valid: false,
          normalizedType,
          byteLength,
          error: MEMO_ERROR_MESSAGES.invalidReturn,
        };
      }
      return { valid: true, normalizedType, byteLength: 32 };
    }
  }
}

/**
 * Zod refinement for Stellar memo string values.
 * Computes exact UTF-8 byte length via Buffer.byteLength and rejects oversized memos.
 */
export const stellarMemoStringSchema = z
  .string()
  .trim()
  .superRefine((val, ctx) => {
    const res = validateStellarMemo(val, "MEMO_TEXT");
    if (!res.valid && res.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: res.error,
      });
    }
  });

/**
 * Zod schema for structured Stellar memo with explicit type.
 */
export const stellarTypedMemoSchema = z
  .object({
    value: z.string().trim(),
    type: stellarMemoTypeEnum.default("MEMO_TEXT"),
  })
  .superRefine((data, ctx) => {
    const res = validateStellarMemo(data.value, data.type);
    if (!res.valid && res.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: res.error,
      });
    }
  });

/**
 * Flexible memo field accepting string or typed memo object.
 */
export const stellarMemoField = z.union([
  stellarMemoStringSchema,
  stellarTypedMemoSchema.transform((m) => m.value),
]);

/**
 * Raw memo input schema that preserves value and optional type for object-level validation.
 */
export const memoInputSchema = z
  .union([
    z.string(),
    z.object({
      value: z.string(),
      type: stellarMemoTypeEnum.optional(),
    }),
  ])
  .optional()
  .transform((raw) => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === "string") {
      return { value: raw.trim(), type: undefined as StellarMemoType | undefined };
    }
    return { value: raw.value.trim(), type: raw.type };
  });

/**
 * Object-level refinement helper ensuring memo conforms to specified or inferred memoType.
 */
export function refineStellarMemo<
  T extends {
    memo?: { value: string; type?: StellarMemoType };
    memoType?: StellarMemoType;
  }
>(data: T, ctx: z.RefinementCtx) {
  if (data.memo !== undefined) {
    const type = normalizeMemoType(data.memoType ?? data.memo.type ?? "MEMO_TEXT");
    if (type === "MEMO_TEXT" && data.memo.value === "") {
      return;
    }
    const res = validateStellarMemo(data.memo.value, type);
    if (!res.valid && res.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memo"],
        message: res.error,
      });
    }
  }
}

