"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

export default function GovernanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      segment="governance"
      title="Governance"
      error={error}
      reset={reset}
    />
  );
}
