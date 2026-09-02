"use client";
// SPDX-License-Identifier: MIT

// The Events feed is code-split behind next/dynamic so the WebSocket/SSE event
// client and the on-chain reader (and the Soroban client modules they pull in)
// are only downloaded when the route is actually opened. A table skeleton in
// the same dimensions as the feed keeps the layout stable — no layout shift.

import dynamic from "next/dynamic";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

const EventFeed = dynamic(
  () => import("@/components/events/EventFeed").then((mod) => mod.EventFeed),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6">
        <LoadingSkeleton lines={2} className="w-64" />
        <div className="flex justify-between">
          <LoadingSkeleton lines={1} className="w-48" />
          <LoadingSkeleton lines={1} className="w-32" />
        </div>
        <LoadingSkeleton variant="table" lines={6} />
      </div>
    ),
  }
);

export default function EventsPage() {
  return <EventFeed />;
}
