"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

/**
 * Segment boundary for /analytics (issue #791). A chart failure no longer
 * removes the user's ability to reach the payments list.
 */
export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} segment="analytics" title="Analytics" />;
}
