// SPDX-License-Identifier: MIT

import { z } from "zod";

// ── Stellar memo validation (issue #1368) ──────────────────────
//
// Stellar Horizon supports four memo types:
//   MEMO_TEXT   — up to 28 UTF-8 *bytes* (not characters)
//   MEMO_ID     — an unsigned 64-bit integer, passed as a decimal string
//   MEMO_HASH   — exactly 32 bytes, hex-encoded (64 hex chars)
//   MEMO_RETURN — exactly 32 bytes, hex-encoded (64 hex chars)
//
// Memo strings arrive from client payloads on the payment routes; invalid
// encoding or an over-limit memo previously only surfaced as a downstream
// RPC error during transaction submission. These schemas reject such input
// fast, with actionable 400 Bad Request messages.

export const MEMO_TEXT_MAX_BYTES = 28;

/** Canonical memo type names as used by the Stellar protocol / SDK. */
export const STELLAR_MEMO_TYPES = [
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
] as const;

export type StellarMemoTypeName = (typeof STELLAR_MEMO_TYPES)[number];

/** User-facing error messages for memo validation failures. */
export const STELLAR_MEMO_ERROR_MESSAGES = {
  tooManyBytes:
    `Memo text must be ${MEMO_TEXT_MAX_BYTES} UTF-8 bytes or fewer ` +
    "(non-ASCII characters such as emojis count as more than one byte). " +
    "Shorten the memo or remove multi-byte characters.",
  invalidId:
    "Memo ID must be a whole-number decimal string between 0 and 18446744073709551615 (unsigned 64-bit integer).",
  notAString: "Memo must be a string.",
  invalidHash:
    "MEMO_HASH must be a 64-character hexadecimal string encoding exactly 32 bytes.",
  invalidReturn:
    "MEMO_RETURN must be a 64-character hexadecimal string encoding exactly 32 bytes.",
} as const;

/** 64 hex characters == exactly 32 bytes. */
const MEMO_HASH_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Unsigned 64-bit integer as a decimal string. JS numbers lose precision
 * above Number.MAX_SAFE_INTEGER, so validate lexically: optional leading
 * '+'/'-' is rejected, digits only, and the value must fit uint64.
 */
function isUint64DecimalString(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  // Strip leading zeros for comparison (e.g. "0001" === "1").
  const normalized = value.replace(/^0+(?=\d)/, "");
  const max = "18446744073709551615";
  if (normalized.length < max.length) return true;
  if (normalized.length > max.length) return false;
  return normalized <= max;
}

/**
 * Byte-length check per the issue: Buffer.byteLength(memo, "utf8") <= 28.
 * Works in both Node (native Buffer) and edge/jsdom test environments
 * (Buffer polyfill via TextEncoder fallback when Buffer is undefined).
 */
export function memoTextByteLength(memo: string): number {
  if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
    return Buffer.byteLength(memo, "utf8");
  }
  return new TextEncoder().encode(memo).length;
}

/**
 * Zod refinement: a MEMO_TEXT value must not exceed 28 UTF-8 bytes.
 * Multibyte characters (é = 2 bytes, emoji = 4 bytes) are counted
 * correctly because the check is on byte length, not string length.
 */
export const memoTextByteLimitRefinement = {
  predicate: (memo: string) => memoTextByteLength(memo) <= MEMO_TEXT_MAX_BYTES,
  message: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
} as const;

/**
 * Shared Zod refinement factory for a text memo field. Attach to any
 * z.string() to enforce the Stellar MEMO_TEXT 28-byte limit:
 *
 *   z.string().superRefine(memoTextRefinement)
 */
export function memoTextRefinement(
  value: string,
  ctx: z.RefinementCtx
): void {
  if (!memoTextByteLimitRefinement.predicate(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: memoTextByteLimitRefinement.message,
    });
  }
}

/**
 * Per-type validation of a memo value, independent of Zod. Exposed for
 * callers (and tests) that need the boolean verdict plus message directly.
 */
export function validateStellarMemo(
  type: StellarMemoTypeName,
  value: string
): { valid: boolean; error?: string } {
  switch (type) {
    case "MEMO_TEXT":
      if (memoTextByteLength(value) > MEMO_TEXT_MAX_BYTES) {
        return {
          valid: false,
          error: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes,
        };
      }
      return { valid: true };
    case "MEMO_ID":
      if (!isUint64DecimalString(value)) {
        return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.invalidId };
      }
      return { valid: true };
    case "MEMO_HASH":
      if (!MEMO_HASH_REGEX.test(value)) {
        return { valid: false, error: STELLAR_MEMO_ERROR_MESSAGES.invalidHash };
      }
      return { valid: true };
    case "MEMO_RETURN":
      if (!MEMO_HASH_REGEX.test(value)) {
        return {
          valid: false,
          error: STELLAR_MEMO_ERROR_MESSAGES.invalidReturn,
        };
      }
      return { valid: true };
  }
}

/** Schema for a MEMO_ID value: a decimal string encoding a uint64. */
export const memoIdSchema = z
  .string()
  .refine(isUint64DecimalString, {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidId,
  });

/** Schema for MEMO_HASH: exactly 32 bytes hex-encoded (64 hex chars). */
export const memoHashSchema = z
  .string()
  .regex(MEMO_HASH_REGEX, {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidHash,
  });

/** Schema for MEMO_RETURN: exactly 32 bytes hex-encoded (64 hex chars). */
export const memoReturnSchema = z
  .string()
  .regex(MEMO_HASH_REGEX, {
    message: STELLAR_MEMO_ERROR_MESSAGES.invalidReturn,
  });

/** Schema for MEMO_TEXT: at most 28 UTF-8 bytes. */
export const memoTextSchema = z
  .string()
  .refine(
    (v) => memoTextByteLength(v) <= MEMO_TEXT_MAX_BYTES,
    { message: STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes }
  );

/**
 * Typed memo payload accepted on payment routes:
 *   { type: "MEMO_TEXT", value: string } | { type: "MEMO_ID", ... } | …
 */
export const typedMemoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MEMO_TEXT"), value: memoTextSchema }),
  z.object({ type: z.literal("MEMO_ID"), value: memoIdSchema }),
  z.object({ type: z.literal("MEMO_HASH"), value: memoHashSchema }),
  z.object({ type: z.literal("MEMO_RETURN"), value: memoReturnSchema }),
]);

/**
 * Untyped legacy memo field (plain string): validated as MEMO_TEXT, which
 * keeps backward compatibility with existing text-only clients while still
 * enforcing the byte limit and rejecting invalid UTF-8 surrogate sequences.
 */
export const legacyMemoSchema = memoTextSchema.optional();
