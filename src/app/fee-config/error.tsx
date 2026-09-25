"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

export default function FeeConfigError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      segment="fee-config"
      title="Fee Configuration"
      error={error}
      reset={reset}
    />
  );
}
