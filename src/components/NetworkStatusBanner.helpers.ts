"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";

/**
 * Manages manual dismissal state for `NetworkStatusBanner` and resets
 * dismissal whenever a degraded episode resolves so subsequent incidents
 * surface again automatically.
 */
export function useHookRpcHealthState(degraded: boolean) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!degraded) {
      setDismissed(false);
    }
  }, [degraded]);

  return { dismissed, setDismissed };
}
