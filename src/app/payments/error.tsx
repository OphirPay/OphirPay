"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

export default function PaymentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      segment="payments"
      title="Payments"
      error={error}
      reset={reset}
    />
  );
}
