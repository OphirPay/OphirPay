// SPDX-License-Identifier: MIT

/**
 * TypeScript type guard and narrowing utilities.
 */

/** Check if a value is non-null (filters null/undefined from arrays). */
export function isNonNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Check if a value is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Check if a value is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value);
}

/**
 * Check if a value is a valid on-chain record id (a positive u64 integer).
 *
 * Soroban contract records (refunds, hooks, etc.) are addressed by u64 ids,
 * while Prisma rows use cuid strings. Passing a cuid string through
 * Number() yields NaN, which fails at the contract boundary — so callers
 * must only invoke on-chain actions when this guard passes.
 */
export function isOnChainId(value: unknown): value is number {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 && /^\d+$/.test(value.trim());
  }
  return false;
}

/** Check if a value is a valid Stellar public key. */
export function isStellarKey(value: unknown): value is string {
  return typeof value === "string" && /^G[A-Z0-9]{55}$/.test(value);
}

/** Check if an error is an instance of Error. */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/** Assert that a value is non-null and throw if it is. */
export function assertNonNull<T>(value: T | null | undefined, message = "Value is null/undefined"): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}
