// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /timelock.
 */
export default function TimelockLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading timelocked actions">
      <Breadcrumb items={[{ label: "Timelock" }]} />
      <div className="space-y-2">
        <Skeleton width="220px" height="2rem" />
        <Skeleton width="360px" height="1rem" />
      </div>
      <LoadingSkeleton variant="stats" />
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
