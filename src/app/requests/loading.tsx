// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /requests.
 */
export default function RequestsLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading payment requests">
      <Breadcrumb items={[{ label: "Payment Requests" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="220px" height="2rem" />
          <Skeleton width="340px" height="1rem" />
        </div>
        <Skeleton width="150px" height="2.5rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="stats" />
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
