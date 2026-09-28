"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useMemo, useState } from "react";
import {
  estimateTransactionFee,
  getConfiguredFeePolicy,
  getFeeRefreshIntervalMs,
  type FeeEstimate,
  type FeePolicy,
} from "@/lib/fee-estimator";

/**
 * Live fee recommendation for a transaction with `operations` operations.
 *
 * Refreshes from Horizon fee statistics every `NEXT_PUBLIC_FEE_REFRESH_MS`
 * (default 30s). Pass `paused` while a transaction is being built/signed so the
 * number the user approved cannot change underneath them.
 *
 * The returned `estimate` is exactly what callers should both display and hand
 * to the transaction builder (`estimate.recommendedFee`), which is what keeps
 * the fee shown before signing equal to the fee submitted.
 */
export function useFeeRecommendation(operations: number, options: { paused?: boolean } = {}) {
  const { paused = false } = options;
  const [policy, setPolicy] = useState<FeePolicy>(getConfiguredFeePolicy);
  const [base, setBase] = useState<FeeEstimate | null>(null);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    const load = (forceRefresh: boolean) => {
      estimateTransactionFee(operations, { policy, forceRefresh })
        .then((e) => {
          if (!cancelled) setBase(e);
        })
        .catch(() => {});
    };
    load(false);
    const timer = setInterval(() => load(true), getFeeRefreshIntervalMs());
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [operations, policy, paused]);

  // Re-derive the total synchronously when the operation count changes so the
  // displayed total never lags the count the transaction will be built with.
  const estimate = useMemo<FeeEstimate | null>(
    () =>
      base && {
        ...base,
        operations,
        estimatedFee: String(Number(base.recommendedFee) * operations),
      },
    [base, operations]
  );

  return { estimate, policy, setPolicy };
}
