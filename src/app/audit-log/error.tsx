"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

/**
 * Segment boundary for /audit-log (issue #791). Keeps navigation usable when
 * the audit view fails, with a retry action.
 */
export default function AuditLogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError error={error} reset={reset} segment="audit-log" title="Audit log" />;
}
