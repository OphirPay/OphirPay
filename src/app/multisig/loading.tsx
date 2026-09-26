// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /multisig.
 */
export default function MultisigLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading multisig wallet">
      <Breadcrumb items={[{ label: "Multisig" }]} />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton width="180px" height="2rem" />
          <Skeleton width="320px" height="1rem" />
        </div>
        <Skeleton width="140px" height="2.5rem" className="rounded-lg" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LoadingSkeleton variant="card" lines={4} />
        <LoadingSkeleton variant="card" lines={4} />
      </div>
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}
