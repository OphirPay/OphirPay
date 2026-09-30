// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function RefundsLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Refunds" }]} />
      <div className="flex items-center justify-between gap-4">
        <LoadingSkeleton lines={2} className="w-64" />
        <LoadingSkeleton lines={1} className="w-28" />
      </div>
      <LoadingSkeleton variant="stats" />
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}
