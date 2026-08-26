// SPDX-License-Identifier: MIT

/**
 * Basic input sanitization utilities to prevent XSS and injection.
 * These are simple defense-in-depth measures — proper validation should
 * happen at the Zod schema layer.
 */

const XSS_PATTERNS = /[<>"'&]/g;
const SQL_INJECTION_PATTERNS = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b)/i;

/**
 * Strip potentially dangerous HTML characters from user input.
 */
export function sanitizeHtml(input: string, maxLength = 5000): string {
  return input
    .slice(0, maxLength)
    .replace(XSS_PATTERNS, "");
}

/**
 * Escape HTML entities for safe rendering of user-provided text.
 */
export function escapeHtml(input: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  };
  return input.replace(/[&<>"']/g, (m) => map[m] ?? m);
}

/**
 * Detect common SQL injection patterns in input.
 * Returns true if suspicious patterns are found.
 */
export function hasSqlInjectionPatterns(input: string): boolean {
  return SQL_INJECTION_PATTERNS.test(input);
}

/**
 * Sanitize a Stellar address for display — only allow valid base32 characters.
 */
export function sanitizeStellarAddress(input: string): string {
  return input.replace(/[^A-Z0-9]/g, "").slice(0, 56);
}

/**
 * Sanitize text for use in a URL path segment.
 */
export function sanitizeSlug(input: string, maxLength = 100): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}
