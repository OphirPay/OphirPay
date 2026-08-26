"use client";
// SPDX-License-Identifier: MIT

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { parsePaymentLink, type ParsedPaymentLink } from "@/lib/payment-link";

export interface PaymentLinkPrefill {
  /** Values to prefill the send form with, or `null` when there is nothing to fill. */
  value: ParsedPaymentLink | null;
  /** A message to surface when a link was present but malformed, otherwise `null`. */
  error: string | null;
}

/**
 * Read shareable-payment-link parameters off the current URL.
 *
 * Lives as a hook so the send page stays presentational and this behaviour can
 * be tested without standing up the wallet, toast and transaction machinery the
 * page depends on.
 *
 * Both fields are `null` for a plain visit to the send page — that is not an
 * error state and must not surface a warning.
 */
export function usePaymentLinkPrefill(): PaymentLinkPrefill {
  const searchParams = useSearchParams();

  return useMemo(() => {
    const result = parsePaymentLink(searchParams);

    if (result.status === "ok") return { value: result.value, error: null };
    if (result.status === "invalid") return { value: null, error: result.error };
    return { value: null, error: null };
  }, [searchParams]);
}
