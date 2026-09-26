// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for Treasury Dashboard.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading dashboard">
      <Breadcrumb items={[{ label: "Treasury" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="220px" height="2rem" />
          <Skeleton width="340px" height="1rem" />
        </div>
        <Skeleton width="130px" height="2.5rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LoadingSkeleton variant="table" lines={5} />
        </div>
        <div className="space-y-6">
          <LoadingSkeleton variant="card" lines={4} />
          <LoadingSkeleton variant="card" lines={3} />
        </div>
      </div>
    </div>
  );
}
