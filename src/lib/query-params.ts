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

/**
 * Extract an ISO/date query parameter (YYYY-MM-DD or ISO timestamp) with validation.
 * Returns defaultValue if missing or invalid, along with validity flag and raw value.
 */
export function getDateParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue = ""
): { value: string; isValid: boolean; raw: string | null } {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === "") {
    return { value: defaultValue, isValid: true, raw };
  }
  const dateStr = raw.trim();
  const timestamp = Date.parse(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00`);
  if (Number.isNaN(timestamp)) {
    return { value: defaultValue, isValid: false, raw };
  }
  return { value: dateStr, isValid: true, raw };
}

/** Extract an enum query parameter with explicit validity tracking. */
export function getValidatedEnumParam<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
  defaultValue: T | "" = ""
): { value: T | ""; isValid: boolean; raw: string | null } {
  const raw = searchParams.get(key);
  if (raw === null || raw === "") {
    return { value: defaultValue, isValid: true, raw };
  }
  if ((allowed as readonly string[]).includes(raw)) {
    return { value: raw as T, isValid: true, raw };
  }
  return { value: defaultValue, isValid: false, raw };
}
