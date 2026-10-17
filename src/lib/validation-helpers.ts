// SPDX-License-Identifier: MIT

import { StrKey } from "@stellar/stellar-sdk";

/**
 * Common validation helpers for forms and inputs.
 * Works standalone or alongside Zod schemas.
 * (Merged from the former validation.ts + validation-helpers.ts.)
 */

export type StellarAddressErrorReason =
  | "empty"
  | "wrong_prefix"
  | "wrong_length"
  | "invalid_checksum";

export interface StellarAddressValidationResult {
  valid: boolean;
  reason: StellarAddressErrorReason | null;
  error: string | null;
}

/**
 * Validate a Stellar Ed25519 public key (G... address) using Stellar SDK's
 * `StrKey.isValidEd25519PublicKey()` with detailed feedback for wrong prefix,
 * wrong length, and failed CRC16 checksum.
 */
export function validateStellarAddress(
  value: string
): StellarAddressValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: "empty",
      error: "Destination address is required.",
    };
  }
  if (!trimmed.startsWith("G")) {
    return {
      valid: false,
      reason: "wrong_prefix",
      error:
        "Invalid Stellar address: must start with G (Ed25519 public key prefix).",
    };
  }
  if (trimmed.length !== 56) {
    return {
      valid: false,
      reason: "wrong_length",
      error: `Invalid Stellar address: must be 56 characters long (currently ${trimmed.length}).`,
    };
  }
  if (!StrKey.isValidEd25519PublicKey(trimmed)) {
    return {
      valid: false,
      reason: "invalid_checksum",
      error: "Invalid Stellar address: StrKey CRC checksum failed.",
    };
  }
  return {
    valid: true,
    reason: null,
    error: null,
  };
}

/** Check if a string is a valid email address. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Check if a number is a valid positive amount. */
export function isValidAmount(value: string, min = 0.0000001, max = 1e12): boolean {
  const num = parseFloat(value);
  return !isNaN(num) && num >= min && num <= max;
}

/** Check if a string is within length bounds. */
export function isValidLength(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max;
}

/** Check if a URL is valid. */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Get a user-friendly error message for a common input field. */
export function getFieldError(field: string, value: string): string | null {
  switch (field) {
    case "email":
      if (!value) return "Email is required";
      if (!isValidEmail(value)) return "Please enter a valid email address";
      return null;
    case "amount":
      if (!value) return "Amount is required";
      if (!isValidAmount(value)) return "Please enter a valid positive amount";
      return null;
    case "url":
      if (!value) return "URL is required";
      if (!isValidUrl(value)) return "Please enter a valid URL";
      return null;
    case "stellarAddress":
    case "destination":
      return validateStellarAddress(value).error;
    default:
      return null;
  }
}

// ── Lightweight form validators (moved from validation.ts) ─────

/** Validate a Stellar amount string (must be positive, max 7 decimals). */
export function validateAmount(value: string): string | null {
  if (!value) return "Amount is required";
  const num = parseFloat(value);
  if (isNaN(num)) return "Amount must be a number";
  if (num <= 0) return "Amount must be greater than 0";
  if (num > 1e12) return "Amount is too large";
  const decimals = value.includes(".") ? value.split(".")[1].length : 0;
  if (decimals > 7) return "Amount can have at most 7 decimal places";
  return null;
}

/**
 * Validate a memo string for Stellar transactions.
 * Mirrors the server-side rules in validation-schemas.ts (memoField):
 * optional, printable text only, ≤ 28 characters and ≤ 28 UTF-8 bytes.
 */
export function validateMemo(value: string): string | null {
  if (!value) return null; // Memo is optional
  // Control characters (NUL, newlines, tabs, ESC, …) are never valid memo
  // content — reject before anything is rendered, logged, or exported.
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return "Memo must not contain control or invisible characters";
  }
  if (value.length > 28) return "Memo must be 28 characters or fewer";
  if (new TextEncoder().encode(value).length > 28) {
    return "Memo must be 28 bytes or fewer (non-ASCII characters count more)";
  }
  return null;
}

/** Validate that two values match (e.g., confirm address). */
export function validateMatch(a: string, b: string, label: string): string | null {
  if (a !== b) return `${label} values do not match`;
  return null;
}
