// SPDX-License-Identifier: MIT

/**
 * Date range presets for analytics and reporting filters.
 */

export type DateRangePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "this-month" | "last-month" | "this-year";

interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

const PRESETS: Record<DateRangePreset, () => DateRange> = {
  today: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start, to: now, label: "Today" };
  },
  yesterday: () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start, to: end, label: "Yesterday" };
  },
  "7d": () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { from: start, to: now, label: "Last 7 days" };
  },
  "30d": () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { from: start, to: now, label: "Last 30 days" };
  },
  "90d": () => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 90);
    return { from: start, to: now, label: "Last 90 days" };
  },
  "this-month": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start, to: now, label: "This month" };
  },
  "last-month": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: start, to: end, label: "Last month" };
  },
  "this-year": () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: start, to: now, label: "This year" };
  },
};

/**
 * Get a date range from a preset name.
 */
export function getDateRange(preset: DateRangePreset): DateRange {
  return PRESETS[preset]();
}

/**
 * Get all available date range presets with labels for dropdown UI.
 */
export function getDateRangePresets(): { value: DateRangePreset; label: string }[] {
  return Object.entries(PRESETS).map(([key, fn]) => ({
    value: key as DateRangePreset,
    label: fn().label,
  }));
}
