// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /address-book.
 */
export default function AddressBookLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading address book">
      <Breadcrumb items={[{ label: "Address Book" }]} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton width="180px" height="2rem" />
          <Skeleton width="320px" height="1rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="100px" height="2.25rem" className="rounded-lg" />
          <Skeleton width="100px" height="2.25rem" className="rounded-lg" />
          <Skeleton width="120px" height="2.25rem" className="rounded-lg" />
        </div>
      </div>
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
