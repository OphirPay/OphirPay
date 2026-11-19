// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

export default function BatchDetailLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Batches", href: "/batches" }, { label: "Batch Details" }]} />
      <LoadingSkeleton lines={2} className="w-72" />
      <LoadingSkeleton variant="stats" />
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}
