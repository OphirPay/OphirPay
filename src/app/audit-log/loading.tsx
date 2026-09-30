// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function AuditLogLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Audit Log" }]} />
      <div className="flex items-center justify-between gap-4">
        <LoadingSkeleton lines={2} className="w-64" />
        <LoadingSkeleton lines={1} className="w-28" />
      </div>
      <LoadingSkeleton variant="card" lines={2} />
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
