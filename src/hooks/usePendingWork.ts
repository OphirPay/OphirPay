"use client";
// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";
import {
  getPendingWork,
  subscribePendingWork,
  type PendingWork,
} from "@/lib/session-lifecycle";

/**
 * Subscribe a component to the pending-work registry (issue #1379).
 *
 * The store lives outside React (`@/lib/session-lifecycle`), so this reads it
 * through `useSyncExternalStore`. The snapshot getter returns the same object
 * until the registry actually changes, which is what keeps React from looping.
 */
export function usePendingWork(): PendingWork {
  return useSyncExternalStore(
    subscribePendingWork,
    getPendingWork,
    getPendingWork
  );
}
