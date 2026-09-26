"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

/**
 * Segment boundary for /batches (issue #791). Keeps navigation usable when
 * a batch view fails, with a retry action.
 */
export default function BatchesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} segment="batches" title="Batches" />;
}
