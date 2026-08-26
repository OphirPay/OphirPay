// SPDX-License-Identifier: MIT

/**
 * Color utility functions for charts, badges, and dynamic theming.
 */

/** OphirPay brand color palette. */
export const COLORS = {
  primary: "#7B68EE",
  secondary: "#14b7e6",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  purple: "#8b5cf6",
} as const;

/** Chart color palette (6 colors for up to 6 datasets). */
export const CHART_COLORS = [
  COLORS.primary,
  COLORS.secondary,
  COLORS.success,
  COLORS.warning,
  COLORS.danger,
  COLORS.purple,
] as const;

/**
 * Lighten a hex color by a percentage (0–100).
 */
export function lighten(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((num >> 16) + (255 - (num >> 16)) * (percent / 100)));
  const g = Math.min(255, (((num >> 8) & 0x00ff) + (255 - ((num >> 8) & 0x00ff)) * (percent / 100)));
  const b = Math.min(255, ((num & 0x0000ff) + (255 - (num & 0x0000ff)) * (percent / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
