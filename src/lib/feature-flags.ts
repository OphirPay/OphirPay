// SPDX-License-Identifier: MIT

/**
 * Simple feature flag system for gradual rollouts and A/B testing.
 * Flags are environment-driven and can be overridden via localStorage in dev.
 */

export const FEATURE_FLAGS = {
  /** Enable multi-asset support (USDC, custom tokens) */
  MULTI_ASSET: process.env.NEXT_PUBLIC_FEATURE_MULTI_ASSET !== "false",
  /** Enable recurring payment scheduler */
  RECURRING_PAYMENTS: process.env.NEXT_PUBLIC_FEATURE_RECURRING !== "false",
  /** Enable webhook delivery */
  WEBHOOKS: process.env.NEXT_PUBLIC_FEATURE_WEBHOOKS !== "false",
  /** Enable advanced analytics */
  ADVANCED_ANALYTICS: process.env.NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS === "true",
  /** Enable API key management */
  API_KEYS: process.env.NEXT_PUBLIC_FEATURE_API_KEYS !== "false",
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

/**
 * Check if a feature flag is enabled.
 * In development, checks localStorage first for overrides.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    const override = localStorage.getItem(`ff_${flag}`);
    if (override === "true") return true;
    if (override === "false") return false;
  }
  return FEATURE_FLAGS[flag] ?? false;
}

/**
 * Override a feature flag in localStorage (dev only).
 */
export function overrideFeatureFlag(flag: FeatureFlag, value: boolean): void {
  if (process.env.NODE_ENV === "development") {
    localStorage.setItem(`ff_${flag}`, String(value));
  }
}
