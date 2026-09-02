// SPDX-License-Identifier: MIT

/**
 * Memo utilities for Stellar: hashing for privacy-preserving memos and
 * type-aware validation. (Merged from the former memo.ts + memo-validation.ts.)
 */

/**
 * Create a simple hash of a string using SubtleCrypto (SHA-256 truncated to 28 chars).
 * Stellar text memos are limited to 28 bytes, so we truncate.
 */
export async function hashMemo(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 28); // Stellar memo limit
}

/**
 * Synchronous fallback using a basic string hash (djb2).
 * Use this when SubtleCrypto is unavailable (e.g., SSR).
 */
export function hashMemoSync(input: string, length = 28): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, length);
}

/**
 * Verify that a memo matches a known reference value.
 */
export function verifyMemo(memo: string, reference: string): boolean {
  return hashMemoSync(memo) === hashMemoSync(reference) || memo === reference;
}

// ── Memo validation (moved from memo-validation.ts) ────────────

export type MemoType = "text" | "id" | "hash" | "return";

export interface MemoValidationResult {
  valid: boolean;
  type: MemoType;
  error?: string;
}

const MEMO_LIMITS: Record<MemoType, number> = {
  text: 28,    // UTF-8 bytes
  id: 0,       // 64-bit unsigned integer (no byte limit needed)
  hash: 32,    // 32 bytes (64 hex chars)
  return: 32,  // 32 bytes (64 hex chars)
};

/**
 * Detect and validate a Stellar memo value.
 * Returns the memo type and whether it's valid.
 */
export function validateMemo(value: string, type: MemoType = "text"): MemoValidationResult {
  if (!value) return { valid: true, type };

  if (type === "id") {
    const id = parseFloat(value);
    if (isNaN(id) || id < 0 || !Number.isSafeInteger(id)) {
      return { valid: false, type, error: "Memo ID must be a non-negative integer." };
    }
    if (id > Number.MAX_SAFE_INTEGER) {
      return { valid: false, type, error: "Memo ID exceeds maximum safe integer." };
    }
    return { valid: true, type };
  }

  if (type === "hash" || type === "return") {
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
      return { valid: false, type, error: `Memo ${type} must be a 64-character hex string.` };
    }
    return { valid: true, type };
  }

  // Text memo
  // Charset: reject C0/C1 control characters — they are never legitimate
  // memo content and keeping them out keeps memos safe to render and log.
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    return {
      valid: false,
      type,
      error: "Memo text must not contain control or invisible characters.",
    };
  }
  if (new TextEncoder().encode(value).length > MEMO_LIMITS.text) {
    return { valid: false, type, error: "Memo text must be 28 bytes or fewer." };
  }

  return { valid: true, type };
}

/**
 * Auto-detect the memo type from its value.
 */
export function detectMemoType(value: string): MemoType {
  if (!value) return "text";
  if (/^\d+$/.test(value)) return "id";
  if (/^[0-9a-fA-F]{64}$/.test(value)) return "hash";
  return "text";
}
