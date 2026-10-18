"use client";
// SPDX-License-Identifier: MIT

import React from "react";
import { cn } from "@/lib/utils";

export interface StatusAnnouncerProps {
  /** The message text to announce to assistive technologies. */
  message?: string | null;
  /**
   * Politeness level of the live region.
   * - "polite": waits until the user is idle (default, for standard transaction and wallet status)
   * - "assertive": announces immediately (for critical errors or time-sensitive alerts)
   */
  politeness?: "polite" | "assertive";
  /** Optional role override. Defaults to "status" for polite, "alert" for assertive. */
  role?: "status" | "alert" | "log";
  /** Atomic announcement ensures the entire live region is re-read upon change. */
  atomic?: boolean;
  /** Test identifier */
  "data-testid"?: string;
  className?: string;
  id?: string;
}

/**
 * Visually hidden ARIA live region that announces asynchronous state transitions
 * (wallet connections, transaction signing, submission, confirmations, and failures)
 * to screen reader users in compliance with WCAG 2.1 AA.
 */
export function StatusAnnouncer({
  message,
  politeness = "polite",
  role,
  atomic = true,
  "data-testid": testId = "status-announcer",
  className,
  id,
}: StatusAnnouncerProps) {
  const resolvedRole = role ?? (politeness === "assertive" ? "alert" : "status");

  return (
    <div
      id={id}
      role={resolvedRole}
      aria-live={politeness}
      aria-atomic={atomic}
      data-testid={testId}
      className={cn("sr-only", className)}
    >
      {message ?? ""}
    </div>
  );
}
