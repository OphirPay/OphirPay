"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      segment="analytics"
      title="Analytics"
      error={error}
      reset={reset}
    />
  );
}
