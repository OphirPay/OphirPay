// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * Stellar transaction memo validation utilities and Zod schemas (Issue #1368).
 *
 * Enforces strict Stellar protocol encoding and byte-size constraints before
 * payment or payment-request creation:
 *   - `MEMO_TEXT`   : Valid UTF-8 string, printable characters only, <= 28 UTF-8 bytes
 *   - `MEMO_ID`     : Unsigned 64-bit integer string (0 .. 18446744073709551615)
 *   - `MEMO_HASH`   : 32-byte hash encoded as a 64-character hexadecimal string
 *   - `MEMO_RETURN` : 32-byte return hash encoded as a 64-character hexadecimal string
 */

export const STELLAR_MEMO_MAX_BYTES = 28;
export const STELLAR_MEMO_HASH_HEX_LENGTH = 64;
export const STELLAR_MAX_U64 = BigInt("18446744073709551615");

export const STELLAR_MEMO_TYPES = [
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
] as const;

export type StellarMemoType = (typeof STELLAR_MEMO_TYPES)[number];

export type StellarMemoTypeInput =
  | StellarMemoType
  | "text"
  | "id"
  | "hash"
  | "return";

// Control chars (C0/C1), zero-width and bidi isolates/overrides/embeddings.
export const STELLAR_MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

export const STELLAR_MEMO_HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;
export const STELLAR_MEMO_U64_DIGITS_REGEX = /^(0|[1-9]\d*)$/;

export const STELLAR_MEMO_ERROR_MESSAGES = {
  tooLong: "Memo must be 28 characters or fewer",
  tooManyBytes:
    "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
  controlChars: "Memo must not contain control or invisible characters",
  invalidUtf8:
    "Memo contains invalid UTF-8 sequences (unpaired surrogate or replacement characters are not allowed)",
  invalidMemoId:
    "MEMO_ID must be an unsigned 64-bit integer string between 0 and 18446744073709551615",
  invalidMemoHash:
    "MEMO_HASH must be a 64-character hexadecimal string representing 32 bytes",
  invalidMemoReturn:
    "MEMO_RETURN must be a 64-character hexadecimal string representing 32 bytes",
} as const;

/**
 * Normalize a caller-supplied memoType (`MEMO_TEXT` or `"text"`, etc.) into the
 * canonical Stellar `MEMO_*` enum value. Defaults to `"MEMO_TEXT"`.
 */
export function normalizeStellarMemoType(
  input?: string | null
): StellarMemoType {
  if (!input) return "MEMO_TEXT";
  const upper = input.trim().toUpperCase();
  if (upper === "MEMO_TEXT" || upper === "TEXT") return "MEMO_TEXT";
  if (upper === "MEMO_ID" || upper === "ID") return "MEMO_ID";
  if (upper === "MEMO_HASH" || upper === "HASH") return "MEMO_HASH";
  if (upper === "MEMO_RETURN" || upper === "RETURN") return "MEMO_RETURN";
  return "MEMO_TEXT";
}

export const stellarMemoTypeSchema = z
  .enum([
    "MEMO_TEXT",
    "MEMO_ID",
    "MEMO_HASH",
    "MEMO_RETURN",
    "text",
    "id",
    "hash",
    "return",
  ])
  .transform((val): StellarMemoType => normalizeStellarMemoType(val));

/**
 * Compute exact UTF-8 byte length of a string using Node's `Buffer.byteLength`.
 */
export function getUtf8ByteLength(memo: string): number {
  return Buffer.byteLength(memo, "utf8");
}

/**
 * Verify that a JavaScript string is well-formed UTF-8 without lone UTF-16
 * surrogates (`\uD800`–`\uDFFF`) or replacement characters (`\uFFFD`).
 */
export function isValidUtf8String(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0xfffd) {
      return false;
    }
    // High surrogate must be followed by a low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      i++; // skip paired low surrogate
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Unpaired low surrogate
      return false;
    }
  }
  return true;
}

/**
 * Returns true if the string contains C0/C1 control characters or invisible
 * zero-width / bidirectional override characters.
 */
export function hasControlOrInvisibleChars(value: string): boolean {
  return STELLAR_MEMO_CONTROL_CHARS.test(value);
}

/**
 * Validate an unsigned 64-bit integer string (`0` .. `18446744073709551615`).
 */
export function isValidStellarMemoId(value: string): boolean {
  if (!STELLAR_MEMO_U64_DIGITS_REGEX.test(value)) {
    return false;
  }
  try {
    const n = BigInt(value);
    return n >= BigInt(0) && n <= STELLAR_MAX_U64;
  } catch {
    return false;
  }
}

/**
 * Validate a 32-byte hex-encoded hash (`MEMO_HASH` or `MEMO_RETURN`).
 */
export function isValidStellarMemoHexHash(value: string): boolean {
  return STELLAR_MEMO_HEX_64_REGEX.test(value);
}

export interface StellarMemoValidationResult {
  valid: boolean;
  memoType: StellarMemoType;
  byteLength: number;
  error?: string;
}

/**
 * Validate a Stellar memo value against its explicit `memoType` (defaulting to
 * `MEMO_TEXT`) and return an actionable validation result.
 */
export function validateStellarMemo(
  memo: string,
  memoTypeInput?: StellarMemoTypeInput
): StellarMemoValidationResult {
  const memoType = normalizeStellarMemoType(memoTypeInput);

  if (!isValidUtf8String(memo)) {
    return {
      valid: false,
      memoType,
      byteLength: getUtf8ByteLength(memo),
      error: STELLAR_MEMO_ERROR_MESSAGES.invalidUtf8,
    };
  }

  const trimmed = memo.trim();
  const byteLength = getUtf8ByteLength(trimmed);

  if (memoType === "MEMO_ID") {
    if (!isValidStellarMemoId(trimmed)) {
      return {
        valid: false,
        memoType,
        byteLength,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidMemoId,
      };
    }
    return { valid: true, memoType, byteLength };
  }

  if (memoType === "MEMO_HASH") {
    if (!isValidStellarMemoHexHash(trimmed)) {
      return {
        valid: false,
        memoType,
        byteLength,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidMemoHash,
      };
    }
    return { valid: true, memoType, byteLength: 32 };
  }

  if (memoType === "MEMO_RETURN") {
    if (!isValidStellarMemoHexHash(trimmed)) {
      return {
        valid: false,
        memoType,
        byteLength,
        error: STELLAR_MEMO_ERROR_MESSAGES.invalidMemoReturn,
      };
    }
    return { valid: true, memoType, byteLength: 32 };
  }

  // MEMO_TEXT
  if (hasControlOrInvisibleChars(trimmed)) {
    return {
      valid: false,
      memoType,
      byteLength,
      error: STELLAR_MEMO_ERROR_MESSAGES.controlChars,
    };
  }

  if (trimmed.length > STELLAR_MEMO_MAX_BYTES) {
    return {
      valid: false,
      memoType,
      byteLength,
      error: STELLAR_MEMO_ERROR_MESSAGES.tooLong,
    };
  }

  if (byteLength > STELLAR_MEMO_MAX_BYTES) {
    return {
      valid: false,
      memoType,
      byteLength,
      error: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
    };
  }

  return { valid: true, memoType, byteLength };
}

/**
 * Standalone Zod schema for `MEMO_TEXT`: trims surrounding whitespace,
 * rejects invalid UTF-8 sequences and control/invisible characters, and
 * enforces `Buffer.byteLength(memo, 'utf8') <= 28`.
 */
export const stellarMemoTextSchema = z
  .string()
  .refine((v) => isValidUtf8String(v), {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidUtf8,
  })
  .transform((v) => v.trim())
  .refine((v) => !hasControlOrInvisibleChars(v), {
    message: STELLAR_MEMO_ERROR_MESSAGES.controlChars,
  })
  .refine((v) => v.length <= STELLAR_MEMO_MAX_BYTES, {
    message: STELLAR_MEMO_ERROR_MESSAGES.tooLong,
  })
  .refine((v) => Buffer.byteLength(v, "utf8") <= STELLAR_MEMO_MAX_BYTES, {
    message: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
  });

/**
 * Standalone Zod schema for `MEMO_ID` (unsigned 64-bit integer string).
 */
export const stellarMemoIdSchema = z
  .string()
  .trim()
  .refine((v) => isValidStellarMemoId(v), {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidMemoId,
  });

/**
 * Standalone Zod schema for `MEMO_HASH` (64-character hex string = 32 bytes).
 */
export const stellarMemoHashSchema = z
  .string()
  .trim()
  .refine((v) => isValidStellarMemoHexHash(v), {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidMemoHash,
  });

/**
 * Standalone Zod schema for `MEMO_RETURN` (64-character hex string = 32 bytes).
 */
export const stellarMemoReturnSchema = z
  .string()
  .trim()
  .refine((v) => isValidStellarMemoHexHash(v), {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidMemoReturn,
  });

/**
 * Zod `superRefine` callback that validates `{ memo, memoType }` pairs
 * according to the Stellar protocol specification.
 */
export function validateStellarMemoSuperRefine(
  val: { memo?: string; memoType?: StellarMemoTypeInput },
  ctx: z.RefinementCtx
): void {
  if (val.memo === undefined) return;

  // Check raw string for invalid UTF-8 sequences before any transformation
  if (!isValidUtf8String(val.memo)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["memo"],
      message: STELLAR_MEMO_ERROR_MESSAGES.invalidUtf8,
    });
    return;
  }

  const trimmed = val.memo.trim();
  const hasExplicitType = val.memoType !== undefined;
  const memoType = normalizeStellarMemoType(val.memoType);

  // An empty or whitespace-only memo with no explicit non-text type is valid
  if (trimmed === "" && (!hasExplicitType || memoType === "MEMO_TEXT")) {
    return;
  }

  const result = validateStellarMemo(trimmed, memoType);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["memo"],
      message: result.error ?? STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
    });
  }
}

/**
 * Combined Zod schema for payloads carrying `memo` and optional `memoType`.
 */
export const stellarMemoPayloadSchema = z
  .object({
    memo: z.string().trim().optional(),
    memoType: stellarMemoTypeSchema.optional(),
  })
  .superRefine(validateStellarMemoSuperRefine);
