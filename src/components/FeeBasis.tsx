// SPDX-License-Identifier: MIT

import type { FeeSource } from "@/lib/network-fee-stats";

export interface FeeBasisProps {
  /** Base fee in stroops that will be signed into the transaction. */
  baseFee: string | number;
  /** Congestion band used for the badge colour. */
  congestion?: "low" | "medium" | "high";
  /** Human-readable justification for the recommendation (from fee stats). */
  basis?: string;
  /** Where the base fee came from. */
  source?: FeeSource;
  /** True when Horizon was unreachable and a cached/configured value is shown. */
  stale?: boolean;
  /** Optional label for the screen this is rendered on. */
  context?: "send" | "batch";
}

const CONGESTION_CLASSES: Record<NonNullable<FeeBasisProps["congestion"]>, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

/**
 * Renders the network fee that will be submitted, together with *why* it was
 * chosen. Required by issue #825:
 *
 *  - "Surface the recommendation and its basis in the send and batch
 *    confirmation screens so the user sees why a fee is higher than usual."
 *  - "An unreachable Horizon falls back to a cached or configured value with a
 *    visible indication."
 *
 * The component is deliberately presentational: the caller passes the exact
 * value it will sign, so the fee shown and the fee submitted cannot diverge.
 */
export default function FeeBasis({
  baseFee,
  congestion = "low",
  basis,
  source = "horizon",
  stale = false,
  context = "send",
}: FeeBasisProps) {
  const degraded = stale || source !== "horizon";

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="fee-basis"
      data-fee-source={source}
      data-fee-stale={degraded ? "true" : "false"}
      data-fee-base={String(baseFee)}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Network fee: ~{baseFee} stroops
        </span>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${CONGESTION_CLASSES[congestion]}`}
          data-testid="fee-congestion"
        >
          {congestion}
        </span>
        {degraded && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            title={
              source === "cache"
                ? "Horizon fee statistics could not be refreshed; showing the last known good values."
                : "Horizon was unreachable; showing the configured fallback fee."
            }
            data-testid="fee-stale-badge"
          >
            {source === "cache" ? "cached" : "fallback"}
          </span>
        )}
      </div>

      {basis && (
        <p
          className="text-xs text-gray-500 dark:text-gray-400"
          data-testid="fee-basis-reason"
        >
          {basis}
        </p>
      )}

      {degraded && (
        <p
          className="text-xs text-amber-600 dark:text-amber-400"
          data-testid="fee-stale-note"
        >
          {context === "batch"
            ? "Live network conditions are unavailable — this batch uses the last known good fee."
            : "Live network conditions are unavailable — the fee above is a cached/configured value."}
        </p>
      )}
    </div>
  );
}
