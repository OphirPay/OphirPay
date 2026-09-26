// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /pause-controls.
 */
export default function PauseControlsLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading emergency pause controls">
      <Breadcrumb items={[{ label: "Pause Controls" }]} />
      <div className="space-y-2">
        <Skeleton width="220px" height="2rem" />
        <Skeleton width="360px" height="1rem" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3"
          >
            <div className="flex justify-between items-center">
              <Skeleton width="100px" height="1.25rem" />
              <Skeleton width="48px" height="1.5rem" className="rounded-full" />
            </div>
            <Skeleton width="180px" height="0.875rem" />
          </div>
        ))}
      </div>
      <LoadingSkeleton variant="card" lines={5} />
    </div>
  );
}
