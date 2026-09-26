// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /hooks.
 */
export default function HooksLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading webhook subscriptions">
      <Breadcrumb items={[{ label: "Webhooks" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="180px" height="2rem" />
          <Skeleton width="300px" height="1rem" />
        </div>
        <Skeleton width="130px" height="2.5rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
