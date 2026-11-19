// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Analytics" }]} />
      <div className="flex items-center justify-between gap-4">
        <LoadingSkeleton lines={2} className="w-64" />
        <LoadingSkeleton lines={1} className="w-24" />
      </div>
      <LoadingSkeleton variant="stats" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSkeleton variant="card" lines={5} />
        <LoadingSkeleton variant="card" lines={5} />
      </div>
    </div>
  );
}
