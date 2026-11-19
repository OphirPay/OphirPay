// SPDX-License-Identifier: MIT

/**
 * Stellar memo encoding and character-set validation (issue #1368).
 *
 * Stellar's protocol defines four memo kinds, and each has a different shape:
 *
 * | Type          | Wire form                      | Limit                     |
 * | ------------- | ------------------------------ | ------------------------- |
 * | `MEMO_TEXT`   | UTF-8 string                   | 28 **bytes**              |
 * | `MEMO_ID`     | unsigned 64-bit integer        | 0 … 2^64-1                |
 * | `MEMO_HASH`   | 32 raw bytes                   | 64 hex characters         |
 * | `MEMO_RETURN` | 32 raw bytes                   | 64 hex characters         |
 *
 * Getting one of those wrong used to surface late: a 15-emoji memo is 30 UTF-16
 * code units but 60 UTF-8 bytes, so `memo.length <= 28` accepted it and the
 * failure only appeared when Horizon rejected the assembled transaction — after
 * the payment row already existed. This module is the single place that knows
 * the real limits, so route validation can fail fast with a 400 and an
 * actionable message *before* any RPC work happens.
 *
 * Why a byte count and not `.length`: `"é"` is one JS character but two UTF-8
 * bytes, and `"😀"` is two UTF-16 code units but four UTF-8 bytes. Stellar
 * measures the encoded bytes, so `TextEncoder` (available on Node and Edge)
 * is the only correct measure.
 */

import { z } from "zod";

// ── Limits ────────────────────────────────────────────────────

/** Maximum UTF-8 payload of a `MEMO_TEXT` (Stellar protocol limit). */
export const MEMO_TEXT_MAX_BYTES = 28;

/** `MEMO_HASH` / `MEMO_RETURN` payload size in bytes. */
export const MEMO_HASH_BYTES = 32;

/** Hex characters in a 32-byte hash/return memo. */
export const MEMO_HASH_HEX_LENGTH = MEMO_HASH_BYTES * 2;

/**
 * Largest value a `MEMO_ID` can carry: 2^64 - 1 (unsigned 64-bit max).
 *
 * Built with `BigInt("…")` rather than a `…n` literal so this module still
 * compiles under the project's pre-ES2020 `target`.
 */
export const MEMO_ID_MAX = BigInt("18446744073709551615");

/**
 * C0/C1 control characters plus zero-width and bidi-override characters.
 *
 * Covers `\u0000-\u001F`, `\u007F-\u009F`, ZWSP/ZWNJ/ZWJ/LRM/RLM
 * (`\u200B-\u200F`), LRE/RLE/PDF/LRO/RLO (`\u202A-\u202E`) and
 * LRI/RLI/FSI/PDI (`\u2066-\u2069`). None of these are legitimate memo
 * content; keeping them out keeps a memo safe to render, log and export.
 */
export const MEMO_CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;

/**
 * An unpaired UTF-16 surrogate. `TextEncoder` silently replaces it with
 * U+FFFD, so an accepted memo would not be the memo the client sent — the
 * transaction would carry a different value than the request.
 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ── Types ─────────────────────────────────────────────────────

/** The four memo kinds Stellar supports, using Horizon's names. */
export const stellarMemoTypes = [
  "MEMO_TEXT",
  "MEMO_ID",
  "MEMO_HASH",
  "MEMO_RETURN",
] as const;

export type StellarMemoType = (typeof stellarMemoTypes)[number];

/**
 * Lowercase aliases (`text`, `id`, `hash`, `return`) are accepted because the
 * existing client helper (`src/lib/memo.ts` → `MemoType`) uses them; they are
 * normalized to the canonical names so only one vocabulary reaches validation.
 */
const MEMO_TYPE_ALIASES: Record<string, StellarMemoType> = {
  text: "MEMO_TEXT",
  id: "MEMO_ID",
  hash: "MEMO_HASH",
  return: "MEMO_RETURN",
};

/** Lenient preprocessor: trims, uppercases and resolves the lowercase aliases. */
function normalizeMemoTypeInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const alias = MEMO_TYPE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed.toUpperCase();
}

/** Zod schema for a memo type: canonical names or their lowercase aliases. */
export const stellarMemoTypeSchema = z.preprocess(
  normalizeMemoTypeInput,
  z.enum(stellarMemoTypes, {
    error: "memoType must be one of MEMO_TEXT, MEMO_ID, MEMO_HASH or MEMO_RETURN",
  })
);

/** A problem with a memo value, structured so routes can map it to an `errors[]` entry. */
export interface MemoValidationIssue {
  /** OphirPay error code (`MEMO_TOO_LONG`, `MEMO_INVALID_FORMAT`, `INVALID_MEMO`). */
  code: string;
  /** User-facing explanation. */
  message: string;
}

// ── Measurement ───────────────────────────────────────────────

/**
 * UTF-8 byte length of a string — what Stellar actually measures.
 *
 * `Buffer.byteLength(value, "utf8")` returns the same number on Node, but
 * `TextEncoder` also works on the Edge runtime, so route handlers do not have
 * to care which runtime they are compiled for.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** True when a string is a well-formed sequence of UTF-16 code units. */
export function isWellFormedUnicode(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

// ── Validation ────────────────────────────────────────────────

/**
 * Validate `value` as a memo of `type`.
 *
 * Returns `null` when the value is valid (including the empty string, which
 * means "no memo"), otherwise the first issue found. Callers decide how to
 * surface it: a Zod refinement on the request schema, or a pre-flight check
 * before building a transaction.
 *
 * The text messages are the ones the API has always returned
 * (`MEMO_ERROR_MESSAGES`), kept byte-for-byte so existing clients and alerts
 * that match on them keep working; the new types get messages that state the
 * exact expected shape.
 */
export function validateStellarMemo(
  value: string,
  type: StellarMemoType = "MEMO_TEXT"
): MemoValidationIssue | null {
  if (value === "") return null;

  if (!isWellFormedUnicode(value)) {
    return {
      code: "INVALID_MEMO",
      message:
        "Memo contains an unpaired surrogate and cannot be encoded as UTF-8.",
    };
  }

  switch (type) {
    case "MEMO_ID": {
      // A decimal string, not `parseFloat`: `parseFloat("123abc")` is 123 and
      // `parseFloat("1e3")` is 1000, so both used to be accepted as ids while
      // the valid uint64 maximum was rejected for exceeding MAX_SAFE_INTEGER.
      // `BigInt` covers the full unsigned 64-bit range exactly.
      if (!/^[0-9]+$/.test(value)) {
        return {
          code: "MEMO_INVALID_FORMAT",
          message:
            "Memo ID must be an unsigned whole number (0-18446744073709551615) with no sign, decimal point, exponent or extra text.",
        };
      }
      if (BigInt(value) > MEMO_ID_MAX) {
        return {
          code: "MEMO_TOO_LONG",
          message:
            "Memo ID exceeds the unsigned 64-bit range (maximum 18446744073709551615).",
        };
      }
      return null;
    }

    case "MEMO_HASH":
    case "MEMO_RETURN": {
      const label = type === "MEMO_HASH" ? "Memo hash" : "Memo return hash";
      if (!/^[0-9a-fA-F]+$/.test(value) || value.length !== MEMO_HASH_HEX_LENGTH) {
        return {
          code: "MEMO_INVALID_FORMAT",
          message: `${label} must be exactly ${MEMO_HASH_HEX_LENGTH} hexadecimal characters (32 bytes); received ${value.length} ${/^[0-9a-fA-F]*$/.test(value) ? "hexadecimal characters" : "characters including non-hexadecimal ones"}.`,
        };
      }
      return null;
    }

    default: {
      // MEMO_TEXT.
      if (MEMO_CONTROL_CHARS.test(value)) {
        return {
          code: "INVALID_MEMO",
          message: "Memo must not contain control or invisible characters",
        };
      }

      // Character count first: it is the message users understand for plain
      // ASCII input, and it is what the long-standing API response said.
      if (value.length > MEMO_TEXT_MAX_BYTES) {
        return {
          code: "MEMO_TOO_LONG",
          message: "Memo must be 28 characters or fewer",
        };
      }

      if (utf8ByteLength(value) > MEMO_TEXT_MAX_BYTES) {
        return {
          code: "MEMO_TOO_LONG",
          // Unchanged from the original API response on purpose: clients and
          // alerting already match on it, and the measured size is available
          // to callers through {@link utf8ByteLength}.
          message: "Memo must be 28 bytes or fewer (non-ASCII characters count more)",
        };
      }

      return null;
    }
  }
}

/** The memo type a request implies: an explicit `memoType`, else `MEMO_TEXT`. */
export function resolveMemoType(
  type: StellarMemoType | undefined
): StellarMemoType {
  return type ?? "MEMO_TEXT";
}

/**
 * Append memo issues for `path` to a Zod refinement context.
 *
 * Shared by every request schema that accepts a memo (`createPaymentSchema`,
 * `createPaymentRequestSchema`, batch recipients, …) so the type-aware rules
 * cannot drift between routes.
 */
export function addMemoIssues(
  ctx: z.RefinementCtx,
  value: string | undefined,
  type: StellarMemoType | undefined,
  path: (string | number)[]
): void {
  if (value === undefined) {
    if (type !== undefined) {
      ctx.addIssue({
        code: "custom",
        path,
        message:
          "memoType was provided without a memo value; omit both or send the memo it describes.",
      });
    }
    return;
  }

  const resolved = resolveMemoType(type);
  const issue = validateStellarMemo(value, resolved);
  if (issue) {
    ctx.addIssue({
      code: "custom",
      path,
      message: issue.message,
    });
  }
}
