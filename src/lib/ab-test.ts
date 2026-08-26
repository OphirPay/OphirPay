// SPDX-License-Identifier: MIT

/**
 * Simple client-side A/B testing utility.
 * Assigns users to variants based on a hash of a stable identifier (e.g., address).
 * No external dependencies.
 */

type Variant = "a" | "b" | "c" | "d";

interface Experiment {
  id: string;
  variants: readonly Variant[];
  /** Which variant a user is assigned to (deterministic based on userId) */
  getVariant: (userId: string) => Variant;
}

/**
 * Create an A/B test experiment.
 * Uses a simple hash of userId + experimentId for deterministic assignment.
 */
export function createExperiment(
  id: string,
  variants: readonly Variant[] = ["a", "b"]
): Experiment {
  return {
    id,
    variants,
    getVariant: (userId: string) => {
      const hash = simpleHash(`${userId}:${id}`);
      return variants[hash % variants.length];
    },
  };
}

/**
 * Track which variant was shown for analytics.
 */
export function trackExperiment(
  experimentId: string,
  variant: Variant,
  userId: string
): void {
  if (typeof window !== "undefined") {
    try {
      const key = `ab_${experimentId}`;
      localStorage.setItem(key, JSON.stringify({ variant, userId, timestamp: Date.now() }));
    } catch {
      // Storage unavailable
    }
  }
}

/** Simple djb2 hash function */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash);
}
