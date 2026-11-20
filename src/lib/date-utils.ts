// SPDX-License-Identifier: MIT

/**
 * Relative timestamp helpers for activity/audit logs.
 */

export interface RelativeTimeProps {
  /** Human readable description, e.g. "2 hours ago". */
  label: string;
  /** Exact ISO 8601 string, intended for a `title` (tooltip) attribute. */
  title: string;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/**
 * Describe how long ago `date` was relative to `now`.
 * Future dates (clock skew) are treated as "Just now".
 */
export function formatRelativeTime(
  date: Date | string | number,
  now: Date | number = Date.now()
): string {
  const then = new Date(date).getTime();
  const seconds = Math.floor((new Date(now).getTime() - then) / 1000);

  if (seconds < MINUTE) return "Just now";
  if (seconds < HOUR) return plural(Math.floor(seconds / MINUTE), "minute");
  if (seconds < DAY) return plural(Math.floor(seconds / HOUR), "hour");
  if (seconds < 2 * DAY) return "Yesterday";
  if (seconds < 30 * DAY) return plural(Math.floor(seconds / DAY), "day");
  return new Date(then).toISOString().split("T")[0];
}

/** Label plus exact ISO string, ready to spread onto a `<time>` element. */
export function relativeTimeProps(
  date: Date | string | number,
  now: Date | number = Date.now()
): RelativeTimeProps {
  return {
    label: formatRelativeTime(date, now),
    title: new Date(date).toISOString(),
  };
}
