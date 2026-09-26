// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /fee-config.
 */
export default function FeeConfigLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading fee configuration">
      <Breadcrumb items={[{ label: "Fee Configuration" }]} />
      <div className="space-y-2">
        <Skeleton width="220px" height="2rem" />
        <Skeleton width="340px" height="1rem" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LoadingSkeleton variant="card" lines={5} />
        <LoadingSkeleton variant="card" lines={5} />
      </div>
    </div>
  );
}
