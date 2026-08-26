// SPDX-License-Identifier: MIT

/**
 * Locale-aware date formatting utilities.
 * Uses Intl for consistent formatting across browsers.
 */

const DEFAULT_LOCALE = "en-US";

/** Format a date for display: "Jan 15, 2026" */
export function formatDateShort(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a date with time: "Jan 15, 2026, 2:30 PM" */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(DEFAULT_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format as ISO date string: "2026-01-15" */
export function formatIsoDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

/** Get the current Unix timestamp in seconds. */
export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Check if a date is within the last N days. */
export function isWithinDays(date: Date | string, days: number): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  return diff <= days * 86400000;
}
