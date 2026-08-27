// SPDX-License-Identifier: MIT

import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

/**
 * Route-level loading fallback for /payments.
 *
 * Without this file, navigating to the payments page flashes the root
 * spinner (`src/app/loading.tsx`). This keeps the payments route on a
 * skeleton that matches the dashboard's loading state instead.
 */
export default function PaymentsLoading() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Payments" }]} />
      <LoadingSkeleton variant="table" lines={5} />
    </div>
  );
}
