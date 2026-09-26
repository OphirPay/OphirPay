// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /batches/[id].
 */
export default function BatchDetailLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading batch details">
      <Breadcrumb
        items={[
          { label: "Batches", href: "/batches" },
          { label: "Batch Details" },
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton width="180px" height="2rem" />
            <Skeleton width="80px" height="1.5rem" className="rounded-full" />
          </div>
          <Skeleton width="260px" height="1rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="100px" height="2.25rem" className="rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-2"
          >
            <Skeleton width="80px" height="0.875rem" />
            <Skeleton width="120px" height="1.5rem" />
          </div>
        ))}
      </div>
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
