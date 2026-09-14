// SPDX-License-Identifier: MIT

/**
 * Payment lifecycle timeline derivation.
 *
 * Payments progress through a fixed pipeline:
 *   created → signed → submitted → confirmed (or failed)
 *
 * This module derives the timeline from whatever data is available — the
 * on-chain Soroban record (`metadata`/`txHash`/`timestamp`) and/or the
 * database `Payment` row (`status`/`createdAt`/`updatedAt`/`completedAt`) —
 * so the UI renders one consistent, testable timeline regardless of source.
 */

export type PaymentLifecycleState =
  | "CREATED"
  | "SIGNED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED";

export interface PaymentLifecycleStep {
  state: PaymentLifecycleState;
  label: string;
  description: string;
  /** Unix seconds when this step was reached. Undefined when not reached. */
  timestamp?: number;
  /** Whether the payment has progressed past/through this step. */
  reached: boolean;
  /** Whether this is the payment's current position in the pipeline. */
  current: boolean;
  /** Whether this step is the end of the pipeline (confirmed/failed). */
  terminal: boolean;
}

export interface LifecycleInput {
  /** Database status (e.g. CREATED, SIGNED, SUBMITTED, CONFIRMED, FAILED, CANCELLED). */
  status?: string | null;
  /** On-chain metadata marker (e.g. "CANCELLED"). */
  metadata?: string | null;
  /** Transaction hash — presence implies the payment reached the chain. */
  txHash?: string | null;
  /** On-chain record timestamp (unix seconds). */
  timestamp?: number;
  /** Database creation time (ISO string, Date, or unix seconds). */
  createdAt?: string | number | Date | null;
  /** Database last-update time (ISO string, Date, or unix seconds). */
  updatedAt?: string | number | Date | null;
  /** Database completion time (ISO string, Date, or unix seconds). */
  completedAt?: string | number | Date | null;
}

/** Normalize any accepted timestamp shape to unix seconds. */
function toUnixSeconds(
  value: string | number | Date | null | undefined
): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return value;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

// The fixed pipeline before the terminal step. The terminal step is either
// CONFIRMED or FAILED and is appended by the derivation below.
const STEP_ORDER: PaymentLifecycleState[] = [
  "CREATED",
  "SIGNED",
  "SUBMITTED",
];

export const LIFECYCLE_LABELS: Record<
  PaymentLifecycleState,
  { label: string; description: string }
> = {
  CREATED: {
    label: "Created",
    description: "Payment record created",
  },
  SIGNED: {
    label: "Signed",
    description: "Transaction signed by the wallet",
  },
  SUBMITTED: {
    label: "Submitted",
    description: "Transaction submitted to the network",
  },
  CONFIRMED: {
    label: "Confirmed",
    description: "Transaction confirmed on-chain",
  },
  FAILED: {
    label: "Failed",
    description: "Transaction failed",
  },
};

/**
 * Derive the lifecycle timeline for a payment.
 *
 * Position rules:
 * - `FAILED` / `CANCELLED` statuses or the `CANCELLED` metadata marker
 *   terminate the timeline at a FAILED step. The failure stage is not
 *   tracked, so neither a failed nor a cancelled payment claims to have
 *   reached signing/submission — only creation is marked as reached.
 * - `CONFIRMED` / `COMPLETED`, or a transaction hash, mean the payment
 *   reached the confirmed terminal step.
 * - `SUBMITTED` / `PENDING` / `PROCESSING` sit at the submitted step;
 *   `SIGNED` at the signed step; everything else at created.
 */
export function derivePaymentLifecycle(
  input: LifecycleInput
): PaymentLifecycleStep[] {
  const status = (input.status ?? "").toUpperCase();
  const isCancelled =
    input.metadata === "CANCELLED" || status === "CANCELLED";
  const isFailed = isCancelled || status === "FAILED";
  const hasTx = Boolean(input.txHash);

  // Pipeline position: 1..3 (created/signed/submitted), 4 = terminal reached
  // (confirmed or failed).
  let position: number;
  if (isFailed) {
    position = 4; // terminal failed
  } else if (status === "CONFIRMED" || status === "COMPLETED" || hasTx) {
    position = 4;
  } else if (
    status === "SUBMITTED" ||
    status === "PENDING" ||
    status === "PROCESSING"
  ) {
    position = 3;
  } else if (status === "SIGNED") {
    position = 2;
  } else {
    position = 1; // CREATED, RECORDED, or unknown
  }

  const createdTs =
    toUnixSeconds(input.createdAt) ?? toUnixSeconds(input.timestamp);
  const updatedTs = toUnixSeconds(input.updatedAt);
  const completedTs = toUnixSeconds(input.completedAt) ?? toUnixSeconds(input.timestamp);

  const steps: PaymentLifecycleStep[] = [];

  for (let i = 0; i < STEP_ORDER.length; i++) {
    const state = STEP_ORDER[i];
    const stepPosition = i + 1;
    const { label, description } = LIFECYCLE_LABELS[state];

    if ((isCancelled || isFailed) && state !== "CREATED") {
      // The failure stage isn't tracked, so failed/cancelled payments never
      // claim to have been signed or submitted — later steps stay pending.
      steps.push({
        state,
        label,
        description,
        reached: false,
        current: false,
        terminal: false,
      });
      continue;
    }

    steps.push({
      state,
      label,
      description,
      reached: stepPosition <= position,
      current: stepPosition === position && !isFailed,
      terminal: false,
      timestamp:
        stepPosition <= position
          ? state === "CREATED"
            ? createdTs
            : updatedTs
          : undefined,
    });
  }

  // Terminal step: confirmed or failed.
  if (isFailed) {
    steps.push({
      state: "FAILED",
      label: isCancelled ? "Cancelled" : "Failed",
      description: isCancelled
        ? "Payment was cancelled before completion"
        : "Payment failed before confirmation",
      reached: true,
      current: true,
      terminal: true,
      timestamp: completedTs,
    });
  } else {
    steps.push({
      state: "CONFIRMED",
      label: LIFECYCLE_LABELS.CONFIRMED.label,
      description: LIFECYCLE_LABELS.CONFIRMED.description,
      reached: position === 4,
      current: position === 4,
      terminal: true,
      timestamp: position === 4 ? completedTs : undefined,
    });
  }

  return steps;
}
