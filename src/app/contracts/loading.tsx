// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function ContractsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <div className="space-y-2">
        <Breadcrumb items={[{ label: "Contracts" }]} />
        <LoadingSkeleton lines={2} className="w-72" />
      </div>
      <LoadingSkeleton variant="card" lines={4} />
      <LoadingSkeleton variant="card" lines={5} />
    </div>
  );
}
