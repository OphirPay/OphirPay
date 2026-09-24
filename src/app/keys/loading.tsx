// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /keys.
 */
export default function KeysLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading API keys">
      <Breadcrumb items={[{ label: "API Keys" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="160px" height="2rem" />
          <Skeleton width="300px" height="1rem" />
        </div>
        <Skeleton width="130px" height="2.5rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}
