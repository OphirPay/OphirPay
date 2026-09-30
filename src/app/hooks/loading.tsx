// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function HooksLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Hooks" }]} />
      <div className="flex items-center justify-between gap-4">
        <LoadingSkeleton lines={2} className="w-64" />
        <LoadingSkeleton lines={1} className="w-32" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingSkeleton variant="card" lines={4} />
        <LoadingSkeleton variant="card" lines={4} />
      </div>
      <LoadingSkeleton variant="table" lines={4} />
    </div>
  );
}
