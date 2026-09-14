"use client";
// SPDX-License-Identifier: MIT

// Analytics is code-split behind next/dynamic so the heavy on-chain metrics and
// chart code (and the Soroban client modules it pulls in) is only downloaded
// when the Analytics route is actually opened. A named skeleton in the same
// grid layout is shown while it loads — no layout shift.

import dynamic from "next/dynamic";
import { Breadcrumb } from "@/components/Breadcrumb";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

const AnalyticsDashboard = dynamic(
  () =>
    import("@/components/analytics/AnalyticsDashboard").then(
      (mod) => mod.AnalyticsDashboard
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <LoadingSkeleton lines={2} className="w-64" />
          <LoadingSkeleton lines={1} className="w-24 h-9" />
        </div>
        <LoadingSkeleton variant="stats" />
      </div>
    ),
  }
);

export default function AnalyticsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Analytics" }]} />
      <AnalyticsDashboard />
    </div>
  );
}