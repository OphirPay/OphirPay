// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /audit-log.
 */
export default function AuditLogLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading audit logs">
      <Breadcrumb items={[{ label: "Audit Log" }]} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton width="160px" height="2rem" />
          <Skeleton width="280px" height="1rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="200px" height="2.25rem" className="rounded-lg" />
          <Skeleton width="90px" height="2.25rem" className="rounded-lg" />
        </div>
      </div>
      <LoadingSkeleton variant="table" lines={8} />
    </div>
  );
}
