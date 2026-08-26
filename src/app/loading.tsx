// SPDX-License-Identifier: MIT

import { Spinner } from "@/components/ui/Spinner";

/**
 * Route-level loading fallback.
 * Shown automatically by Next.js during page transitions.
 */
export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <Spinner size="lg" className="mb-4" />
        <p className="text-slate-400 text-sm">Loading...</p>
      </div>
    </div>
  );
}
