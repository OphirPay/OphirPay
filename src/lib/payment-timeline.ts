// SPDX-License-Identifier: MIT

import type { Payment, PaymentStatus } from "@/types";
import { getStellarExplorerUrl } from "@/lib/stellar";

export type TimelineStage =
  | "created"
  | "signed"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled";

export type StepState =
  | "completed"
  | "active"
  | "upcoming"
  | "failed"
  | "cancelled";

export interface TimelineStep {
  stage: TimelineStage;
  title: string;
  description: string;
  state: StepState;
  timestamp?: string;
  txHash?: string;
  explorerUrl?: string;
  errorMessage?: string;
  note?: string;
}

export interface PaymentAuditEvent {
  type?: string;
  kind?: string;
  action?: string;
  timestamp?: string;
  note?: string;
  details?: string;
  valid?: boolean;
}

export interface ParsedPaymentMetadata {
  signedAt?: string;
  submittedAt?: string;
  confirmedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  events?: PaymentAuditEvent[];
  audits?: PaymentAuditEvent[];
  auditLog?: PaymentAuditEvent[];
  [key: string]: unknown;
}

/**
 * Safely parses the payment metadata JSON string if present.
 */
export function parsePaymentMetadata(
  metadata?: string | null
): ParsedPaymentMetadata {
  if (!metadata || typeof metadata !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(metadata);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedPaymentMetadata;
    }
  } catch {
    // If metadata is not valid JSON, ignore and return empty object
  }
  return {};
}

/**
 * Derives a deterministic 4-step lifecycle timeline from payment status,
 * timestamps, transaction hash, error messages, and audit metadata.
 *
 * Sequence: Created → Signed → Submitted → Confirmed / Failed / Cancelled
 */
export function derivePaymentTimeline(payment: Payment): TimelineStep[] {
  const meta = parsePaymentMetadata(payment.metadata);
  const status: PaymentStatus = payment.status;
  const txHash = payment.transactionHash || undefined;
  const explorerUrl = txHash ? getStellarExplorerUrl(txHash) : undefined;

  // Extract relevant timestamps from audit/metadata or fallbacks
  const createdTimestamp = payment.createdAt;
  const signedTimestamp =
    meta.signedAt ||
    (status !== "CREATED" && status !== "PENDING"
      ? payment.updatedAt
      : undefined);
  const submittedTimestamp =
    meta.submittedAt || (txHash ? payment.updatedAt : undefined);
  const completedTimestamp =
    payment.completedAt ||
    meta.confirmedAt ||
    (status === "COMPLETED" || status === "CONFIRMED"
      ? payment.updatedAt
      : undefined);
  const failedTimestamp =
    meta.failedAt || (status === "FAILED" ? payment.updatedAt : undefined);
  const cancelledTimestamp =
    meta.cancelledAt ||
    (status === "CANCELLED" ? payment.updatedAt : undefined);

  // ── Step 1: Created ──────────────────────────────────────────
  const step1: TimelineStep = {
    stage: "created",
    title: "Created",
    description: "Payment intent initialized in ledger",
    state: "completed",
    timestamp: createdTimestamp,
  };

  // ── Step 2: Signed ───────────────────────────────────────────
  let step2State: StepState = "upcoming";
  let step2Desc = "Awaiting cryptographic wallet signature";

  if (status === "PENDING") {
    step2State = "active";
    step2Desc = "Ready for payer wallet signature";
  } else if (
    status === "SIGNED" ||
    status === "SUBMITTED" ||
    status === "PROCESSING" ||
    status === "CONFIRMED" ||
    status === "COMPLETED"
  ) {
    step2State = "completed";
    step2Desc = "Authorized with payer wallet signature";
  } else if (status === "FAILED") {
    if (txHash || meta.signedAt || meta.submittedAt) {
      step2State = "completed";
      step2Desc = "Authorized with payer wallet signature";
    } else {
      step2State = "failed";
      step2Desc = "Failed during authorization";
    }
  } else if (status === "CANCELLED") {
    if (meta.signedAt) {
      step2State = "completed";
      step2Desc = "Authorized before cancellation";
    } else {
      step2State = "cancelled";
      step2Desc = "Signing cancelled";
    }
  }

  const step2: TimelineStep = {
    stage: "signed",
    title: "Signed",
    description: step2Desc,
    state: step2State,
    timestamp: step2State === "completed" ? signedTimestamp : undefined,
  };

  // ── Step 3: Submitted ─────────────────────────────────────────
  let step3State: StepState = "upcoming";
  let step3Desc = "Awaiting broadcast to Stellar network";

  if (status === "PROCESSING" && !txHash) {
    step3State = "active";
    step3Desc = "Submitting transaction to Horizon / RPC";
  } else if (
    status === "SUBMITTED" ||
    status === "CONFIRMED" ||
    status === "COMPLETED" ||
    txHash
  ) {
    step3State = "completed";
    step3Desc = "Broadcast to Stellar network";
  } else if (status === "FAILED") {
    if (txHash || meta.submittedAt) {
      step3State = "completed";
      step3Desc = "Broadcast to Stellar network";
    } else if (step2State === "completed") {
      step3State = "failed";
      step3Desc = "Submission to network failed";
    } else {
      step3State = "cancelled";
      step3Desc = "Submission aborted";
    }
  } else if (status === "CANCELLED") {
    if (txHash || meta.submittedAt) {
      step3State = "completed";
      step3Desc = "Broadcast before cancellation";
    } else {
      step3State = "cancelled";
      step3Desc = "Submission cancelled";
    }
  }

  const step3: TimelineStep = {
    stage: "submitted",
    title: "Submitted",
    description: step3Desc,
    state: step3State,
    timestamp:
      step3State === "completed"
        ? submittedTimestamp || signedTimestamp
        : undefined,
    txHash,
    explorerUrl,
  };

  // ── Step 4: Confirmed / Failed / Cancelled ────────────────────
  let step4: TimelineStep;

  if (status === "FAILED") {
    step4 = {
      stage: "failed",
      title: "Failed",
      description:
        payment.errorMessage || "Payment execution failed on-chain or during submission",
      state: "failed",
      timestamp: failedTimestamp || payment.updatedAt,
      errorMessage: payment.errorMessage || undefined,
      txHash,
      explorerUrl,
    };
  } else if (status === "CANCELLED") {
    step4 = {
      stage: "cancelled",
      title: "Cancelled",
      description: "Payment was cancelled prior to execution",
      state: "cancelled",
      timestamp: cancelledTimestamp || payment.updatedAt,
    };
  } else if (status === "CONFIRMED" || status === "COMPLETED") {
    step4 = {
      stage: "confirmed",
      title: "Confirmed",
      description: "Transaction confirmed on-chain in ledger",
      state: "completed",
      timestamp: completedTimestamp || payment.updatedAt,
      txHash,
      explorerUrl,
    };
  } else if (status === "SUBMITTED" || status === "PROCESSING") {
    step4 = {
      stage: "confirmed",
      title: "Confirmed",
      description: "Awaiting ledger close and on-chain confirmation",
      state: "active",
      txHash,
      explorerUrl,
    };
  } else {
    step4 = {
      stage: "confirmed",
      title: "Confirmed",
      description: "Awaiting on-chain confirmation",
      state: "upcoming",
    };
  }

  return [step1, step2, step3, step4];
}

/**
 * Extracts combined list of audit/event log entries from metadata.
 */
export function extractAuditEvents(
  payment: Payment
): PaymentAuditEvent[] {
  const meta = parsePaymentMetadata(payment.metadata);
  const events: PaymentAuditEvent[] = [];

  if (Array.isArray(meta.events)) {
    events.push(...meta.events);
  }
  if (Array.isArray(meta.audits)) {
    events.push(...meta.audits);
  }
  if (Array.isArray(meta.auditLog)) {
    events.push(...meta.auditLog);
  }

  return events;
}
