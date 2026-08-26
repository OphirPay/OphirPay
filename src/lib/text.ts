// SPDX-License-Identifier: MIT

/**
 * Text utilities for truncation, pluralization, and title casing.
 */

/** Truncate text to a maximum length with ellipsis. */
export function truncate(text: string, maxLength = 50, ellipsis = "…"): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - ellipsis.length).trim() + ellipsis;
}

/** Truncate from the middle (e.g., for addresses: GABC...XYZ). */
export function truncateMiddle(text: string, startChars = 6, endChars = 4): string {
  if (!text || text.length <= startChars + endChars + 3) return text;
  return `${text.slice(0, startChars)}…${text.slice(-endChars)}`;
}

/** Pluralize a word based on count. */
export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural ?? singular + "s"}`;
}

/** Convert snake_case or UPPER_CASE to Title Case. */
export function titleCase(input: string): string {
  return input
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert bytes to human-readable size. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}
