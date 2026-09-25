"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

/**
 * Segment boundary for /payments (issue #791). A render error here shows a
 * contained card with retry instead of replacing the shell + navigation.
 */
export default function PaymentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} segment="payments" title="Payments" />;
}
