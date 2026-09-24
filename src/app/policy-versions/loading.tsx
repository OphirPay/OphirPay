// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /policy-versions.
 */
export default function PolicyVersionsLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading policy versions">
      <Breadcrumb items={[{ label: "Policy Versions" }]} />
      <div className="space-y-2">
        <Skeleton width="220px" height="2rem" />
        <Skeleton width="340px" height="1rem" />
      </div>
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
