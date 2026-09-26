// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /governance.
 */
export default function GovernanceLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading governance proposals">
      <Breadcrumb items={[{ label: "Governance" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="200px" height="2rem" />
          <Skeleton width="320px" height="1rem" />
        </div>
        <Skeleton width="140px" height="2.5rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <LoadingSkeleton key={i} variant="card" lines={3} />
        ))}
      </div>
    </div>
  );
}
