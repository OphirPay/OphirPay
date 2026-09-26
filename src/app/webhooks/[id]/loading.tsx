// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /webhooks/[id].
 */
export default function WebhookDetailLoading() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-label="Loading webhook details">
      <Breadcrumb
        items={[
          { label: "Webhooks", href: "/webhooks" },
          { label: "Endpoint Details" },
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton width="220px" height="2rem" />
            <Skeleton width="70px" height="1.5rem" className="rounded-full" />
          </div>
          <Skeleton width="340px" height="1rem" />
        </div>
        <div className="flex gap-2">
          <Skeleton width="110px" height="2.25rem" className="rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LoadingSkeleton variant="detail" lines={5} />
        </div>
        <div className="space-y-6">
          <LoadingSkeleton variant="card" lines={3} />
          <LoadingSkeleton variant="card" lines={3} />
        </div>
      </div>
      <LoadingSkeleton variant="table" lines={6} />
    </div>
  );
}
