// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /contracts.
 */
export default function ContractsLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading smart contracts">
      <Breadcrumb items={[{ label: "Contracts" }]} />
      <div className="space-y-2">
        <Skeleton width="200px" height="2rem" />
        <Skeleton width="340px" height="1rem" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LoadingSkeleton variant="card" lines={4} />
        <LoadingSkeleton variant="card" lines={4} />
      </div>
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}
