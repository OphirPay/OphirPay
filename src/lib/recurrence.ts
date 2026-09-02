// SPDX-License-Identifier: MIT

import type { Frequency } from "@prisma/client";

export type { Frequency };

/**
 * Shared, client-safe helpers for recurring payments. Mirrors the schedule
 * math used by the API routes and the server-side scheduler so the UI's
 * "next run" preview always matches what is actually persisted.
 */

export const FREQUENCY_OPTIONS: Frequency[] = [
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

/**
 * Next run time for a frequency computed from a reference date. This must
 * stay in sync with the server-side logic used in the POST /api/recurring
 * route and the scheduler.
 */
export function nextRunAt(ref: Date, frequency: Frequency): Date {
  const d = new Date(ref.getTime());
  switch (frequency) {
    case "DAILY":
      d.setDate(d.getDate() + 1);
      break;
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "BIWEEKLY":
      d.setDate(d.getDate() + 14);
      break;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      throw new Error(`Unsupported frequency: ${String(frequency)}`);
  }
  return d;
}

/** Canonical label for a frequency value, with a safe fallback. */
export function frequencyLabel(frequency: string): string {
  return FREQUENCY_LABELS[frequency as Frequency] ?? frequency;
}
