"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

export default function WebhooksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      segment="webhooks"
      title="Webhooks"
      error={error}
      reset={reset}
    />
  );
}
