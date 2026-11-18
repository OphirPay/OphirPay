// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * Valid Stellar memo types accepted by payment endpoints:
 * - `text`: UTF-8 string up to 28 bytes
 * - `id`: 64-bit unsigned integer
 * - `hash`: 32-byte hash (64 hex characters)
 * - `return`: 32-byte return hash (64 hex characters)
 */
export const validMemoTypes = ["text", "id", "hash", "return"] as const;
export type ValidMemoType = (typeof validMemoTypes)[number];

/**
 * Zod enum schema strictly validating that a memoType is one of 'text', 'id', 'hash', or 'return'.
 */
export const memoTypeEnum = z.enum(validMemoTypes, {
  error: "memoType must be one of 'text', 'id', 'hash', or 'return'",
});

/**
 * Permissive schema that accepts either the lowercase shorthand ('text', 'id', 'hash', 'return')
 * or the uppercase Horizon canonical format ('MEMO_TEXT', 'MEMO_ID', 'MEMO_HASH', 'MEMO_RETURN'),
 * normalizing to the lowercase wire form.
 */
export const normalizedMemoTypeSchema = z.preprocess((val) => {
  if (typeof val !== "string") return val;
  const lower = val.trim().toLowerCase();
  if (lower.startsWith("memo_")) {
    return lower.slice(5);
  }
  return lower;
}, memoTypeEnum);

/**
 * Helper to check whether a string is a valid memo type.
 */
export function isValidMemoType(value: unknown): value is ValidMemoType {
  return typeof value === "string" && (validMemoTypes as readonly string[]).includes(value.toLowerCase().trim());
}
