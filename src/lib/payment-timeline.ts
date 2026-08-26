// SPDX-License-Identifier: MIT

import type { PaymentStatus } from "@/types";

/**
 * Derives the payment lifecycle timeline from a payment record.
 *
 * Kept as a pure function rather than inline JSX so every status maps to an
 * asserted, reviewable shape. The lifecycle the UI presents is
 * created → signed → submitted → confirmed, with failure and cancellation
 * terminating it partway.
 */

/**
 * Runtime list of the statuses in the canonical `PaymentStatus` union, so tests
 * can iterate every one. Typed against that union rather than redeclaring it —
 * a second copy of the status list is a second thing to keep in sync.
 */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "CREATED",
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type TimelineStepKey = "created" | "signed" | "submitted" | "confirmed";

/**
 * `skipped` is distinct from `upcoming`: an upcoming step may still happen,
 * whereas a skipped one never will because the payment terminated first.
 * Rendering them identically would tell a user their cancelled payment is
 * still on its way.
 */
export type TimelineStepState =
  | "done"
  | "current"
  | "upcoming"
  | "failed"
  | "skipped";

export interface TimelineStep {
  key: TimelineStepKey;
  label: string;
  state: TimelineStepState;
}

export interface PaymentTimelineInput {
  status: string;
  /**
   * Presence of a transaction hash is what distinguishes a payment that failed
   * *before* reaching the network from one the network rejected. Status alone
   * cannot tell those apart, and showing "submitted" for a payment that was
   * never broadcast would be wrong.
   */
  transactionHash?: string | null;
}

const STEP_LABELS: Record<TimelineStepKey, string> = {
  created: "Created",
  signed: "Signed",
  submitted: "Submitted",
  confirmed: "Confirmed",
};

const ORDER: TimelineStepKey[] = ["created", "signed", "submitted", "confirmed"];

function steps(map: Record<TimelineStepKey, TimelineStepState>): TimelineStep[] {
  return ORDER.map((key) => ({ key, label: STEP_LABELS[key], state: map[key] }));
}

/**
 * Build the ordered lifecycle steps for a payment.
 *
 * An unrecognised status is treated as freshly created rather than throwing —
 * a detail page must still render if the enum gains a value the frontend has
 * not been taught about yet.
 */
export function buildPaymentTimeline({
  status,
  transactionHash,
}: PaymentTimelineInput): TimelineStep[] {
  switch (status) {
    case "COMPLETED":
      return steps({
        created: "done",
        signed: "done",
        submitted: "done",
        confirmed: "done",
      });

    case "PROCESSING":
      return steps({
        created: "done",
        signed: "done",
        submitted: "done",
        confirmed: "current",
      });

    case "PENDING":
      return steps({
        created: "done",
        signed: "done",
        submitted: "current",
        confirmed: "upcoming",
      });

    case "FAILED":
      // With a hash the transaction reached the network and was rejected there;
      // without one it never got that far.
      return transactionHash
        ? steps({
            created: "done",
            signed: "done",
            submitted: "done",
            confirmed: "failed",
          })
        : steps({
            created: "done",
            signed: "done",
            submitted: "failed",
            confirmed: "skipped",
          });

    case "CANCELLED":
      return steps({
        created: "done",
        signed: "skipped",
        submitted: "skipped",
        confirmed: "skipped",
      });

    case "CREATED":
    default:
      return steps({
        created: "done",
        signed: "current",
        submitted: "upcoming",
        confirmed: "upcoming",
      });
  }
}

/** True when the payment can no longer progress. */
export function isTerminalStatus(status: string): boolean {
  return (
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
  );
}
