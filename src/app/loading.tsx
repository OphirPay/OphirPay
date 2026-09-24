// SPDX-License-Identifier: MIT

import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Root route-level loading fallback.
 * Renders a structured page-shaped skeleton to minimize Cumulative Layout Shift (CLS).
 */
export default function Loading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading page content">
      <div className="space-y-2">
        <Skeleton width="140px" height="1rem" />
        <Skeleton width="260px" height="2rem" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LoadingSkeleton variant="card" lines={4} />
        <LoadingSkeleton variant="card" lines={4} />
      </div>
    </div>
  );
}
