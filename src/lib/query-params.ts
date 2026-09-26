// SPDX-License-Identifier: MIT

/**
 * Safe URL query parameter parsing utilities.
 * Provides typed extraction with defaults and validation.
 */

/** Extract a string query parameter with a default. */
export function getStringParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue = ""
): string {
  return searchParams.get(key) ?? defaultValue;
}

/** Extract a numeric query parameter with bounds checking. */
export function getNumberParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: number,
  min = -Infinity,
  max = Infinity
): number {
  const raw = searchParams.get(key);
  if (raw === null) return defaultValue;
  const num = parseFloat(raw);
  if (isNaN(num)) return defaultValue;
  return Math.max(min, Math.min(max, num));
}

/** Extract a boolean query parameter (true for "1", "true", "yes"). */
export function getBoolParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue = false
): boolean {
  const raw = searchParams.get(key);
  if (raw === null) return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

/** Extract an enum query parameter with validation. */
export function getEnumParam<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
  defaultValue: T
): T {
  const raw = searchParams.get(key);
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return defaultValue;
}

/** Check if a string matches YYYY-MM-DD date format and is a valid calendar date. */
export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(dateStr);
}

/** Remove empty or specified keys from URLSearchParams, returning a new instance. */
export function cleanSearchParams(
  params: URLSearchParams,
  keysToRemove: string[] = []
): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (!keysToRemove.includes(key) && value !== "" && value !== null && value !== undefined) {
      next.append(key, value);
    }
  }
  return next;
}

