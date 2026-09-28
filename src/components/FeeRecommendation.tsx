"use client";
// SPDX-License-Identifier: MIT

import {
  FEE_POLICIES,
  POLICY_LABELS,
  describeFeeBasis,
  isFeePolicy,
  stroopsToXlm,
  type FeeEstimate,
  type FeePolicy,
} from "@/lib/fee-estimator";

const CONGESTION_STYLES: Record<FeeEstimate["networkCongestion"], string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  unknown: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function describeStale(estimate: FeeEstimate, now = Date.now()): string {
  if (estimate.source === "fallback" || estimate.fetchedAt === null) {
    return "Horizon is unreachable — showing the configured fallback fee, not live network data.";
  }
  const seconds = Math.max(0, Math.round((now - estimate.fetchedAt) / 1000));
  const age = seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
  return `Horizon is unreachable — showing the last known fee from ${age} ago.`;
}

interface FeeRecommendationProps {
  estimate: FeeEstimate | null;
  /** When provided, renders a low / normal / priority selector. */
  onPolicyChange?: (policy: FeePolicy) => void;
  disabled?: boolean;
}

/**
 * The fee the user is about to sign, why it is what it is, and whether it is
 * live or a fallback. Shared by the send screen and the batch confirmation.
 */
export function FeeRecommendation({ estimate, onPolicyChange, disabled }: FeeRecommendationProps) {
  if (!estimate) return null;

  const perOp = `${estimate.recommendedFee} stroops`;
  const opsNote = estimate.operations > 1 ? ` × ${estimate.operations} operations` : "";

  return (
    <div className="space-y-1.5 text-xs" data-testid="fee-recommendation">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-500 dark:text-gray-400" data-testid="fee-total">
          Network fee: {stroopsToXlm(estimate.estimatedFee)} XLM ({perOp}
          {opsNote})
        </span>
        <span
          data-testid="fee-congestion"
          className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${CONGESTION_STYLES[estimate.networkCongestion]}`}
        >
          {estimate.networkCongestion}
        </span>
        {onPolicyChange && (
          <select
            aria-label="Fee priority"
            data-testid="fee-policy-select"
            value={estimate.policy}
            disabled={disabled}
            onChange={(e) => isFeePolicy(e.target.value) && onPolicyChange(e.target.value)}
            className="ml-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-xs text-gray-700 dark:text-gray-300"
          >
            {FEE_POLICIES.map((p) => (
              <option key={p} value={p}>
                {POLICY_LABELS[p]}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-gray-500 dark:text-gray-400" data-testid="fee-basis">
        {describeFeeBasis(estimate)}
      </p>
      {estimate.stale && (
        <p
          role="status"
          data-testid="fee-stale-warning"
          className="text-amber-700 dark:text-amber-400"
        >
          {describeStale(estimate)}
        </p>
      )}
    </div>
  );
}
