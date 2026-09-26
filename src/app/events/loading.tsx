// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /events.
 */
export default function EventsLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading contract events">
      <Breadcrumb items={[{ label: "Events" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="160px" height="2rem" />
          <Skeleton width="280px" height="1rem" />
        </div>
        <Skeleton width="110px" height="2.25rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="table" lines={8} />
    </div>
  );
}
