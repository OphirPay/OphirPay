// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { dispatchWebhookEventAsync } from "@/lib/webhook-dispatcher";
import { WEBHOOK_EVENTS } from "@/app/api/webhooks/event-types";
import { NOTIFY } from "@/lib/notifications";

/** Minimum interval between reminders for a given payment request (1 hour). */
export const DEFAULT_REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

/** Maximum reminders allowed per payment request. */
export const MAX_REMINDERS_PER_REQUEST = 5;

export interface RequestRecord {
  id: string;
  status: string;
  dueDate?: Date | string | null;
  expiresAt?: Date | string | null;
  reminderCount?: number;
  lastReminderAt?: Date | string | null;
  overdueNotifiedAt?: Date | string | null;
  paidNotifiedAt?: Date | string | null;
  amount?: unknown;
  assetCode?: string;
  description?: string | null;
  recipientAddress?: string | null;
  userId?: string;
}

/**
 * Determine if a payment request is past its due date or expiration date.
 * Clock-injected for deterministic testing.
 */
export function isRequestOverdue(
  request: Pick<RequestRecord, "status" | "dueDate" | "expiresAt">,
  now = new Date()
): boolean {
  if (request.status !== "PENDING" && request.status !== "OVERDUE") {
    return false;
  }

  const nowMs = now.getTime();

  if (request.expiresAt) {
    const expiresMs = new Date(request.expiresAt).getTime();
    if (!isNaN(expiresMs) && expiresMs <= nowMs) {
      return true;
    }
  }

  if (request.dueDate) {
    const dueMs = new Date(request.dueDate).getTime();
    if (!isNaN(dueMs) && dueMs <= nowMs) {
      return true;
    }
  }

  return false;
}

export interface ReminderCheckResult {
  allowed: boolean;
  reason?: string;
  cooldownRemainingSeconds?: number;
}

/**
 * Check if a reminder can be sent for a payment request.
 * Enforces:
 * - Request must be active (PENDING or OVERDUE).
 * - Maximum reminder count cap (e.g. 5 reminders).
 * - Minimum cooldown window between reminders (e.g. 1 hour).
 */
export function canSendReminder(
  request: Pick<RequestRecord, "status" | "reminderCount" | "lastReminderAt">,
  now = new Date(),
  options: {
    minIntervalMs?: number;
    maxReminders?: number;
  } = {}
): ReminderCheckResult {
  const minInterval = options.minIntervalMs ?? DEFAULT_REMINDER_COOLDOWN_MS;
  const maxReminders = options.maxReminders ?? MAX_REMINDERS_PER_REQUEST;

  if (request.status !== "PENDING" && request.status !== "OVERDUE") {
    return {
      allowed: false,
      reason: "Reminders can only be sent for pending or overdue payment requests.",
    };
  }

  const count = request.reminderCount ?? 0;
  if (count >= maxReminders) {
    return {
      allowed: false,
      reason: `Maximum limit of ${maxReminders} reminders reached for this request.`,
    };
  }

  if (request.lastReminderAt) {
    const lastMs = new Date(request.lastReminderAt).getTime();
    const elapsed = now.getTime() - lastMs;
    if (elapsed < minInterval) {
      const remainingSeconds = Math.ceil((minInterval - elapsed) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      return {
        allowed: false,
        reason: `Please wait ${remainingMinutes} minute${
          remainingMinutes !== 1 ? "s" : ""
        } before sending another reminder.`,
        cooldownRemainingSeconds: remainingSeconds,
      };
    }
  }

  return { allowed: true };
}

export interface TransitionOutcome {
  id: string;
  previousStatus: string;
  newStatus: string;
}

export interface TransitionJobResult {
  checked: number;
  transitioned: number;
  skipped: number;
  results: TransitionOutcome[];
}

/**
 * Scheduled job to transition overdue / expired payment requests.
 *
 * Guarantees:
 * - Marked overdue automatically and visibly.
 * - Emits webhook event and notification exactly once (enforced by atomic conditional update on overdueNotifiedAt).
 * - Clock-injected for testability.
 */
export async function transitionOverduePaymentRequests(
  now = new Date(),
  prismaClient = prisma
): Promise<TransitionJobResult> {
  const overdueCandidates = await prismaClient.paymentRequest.findMany({
    where: {
      status: "PENDING",
      OR: [
        { dueDate: { lte: now } },
        { expiresAt: { lte: now } },
      ],
    },
  });

  const results: TransitionOutcome[] = [];
  let transitioned = 0;
  let skipped = 0;

  for (const candidate of overdueCandidates) {
    // Determine whether request is expired or overdue
    const isExpired =
      candidate.expiresAt && new Date(candidate.expiresAt).getTime() <= now.getTime();
    const newStatus = isExpired ? "EXPIRED" : "OVERDUE";

    // Atomic update: only succeeds if status is still PENDING and overdueNotifiedAt is null
    const updateCount = await prismaClient.paymentRequest.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
        overdueNotifiedAt: null,
      },
      data: {
        status: newStatus as any,
        overdueNotifiedAt: now,
      },
    });

    if (updateCount.count > 0) {
      transitioned++;
      results.push({
        id: candidate.id,
        previousStatus: candidate.status,
        newStatus,
      });

      logger.info("Payment request transitioned to overdue/expired", {
        id: candidate.id,
        newStatus,
      });

      // Emit webhook exactly once
      const eventType =
        newStatus === "EXPIRED"
          ? WEBHOOK_EVENTS.REQUEST_EXPIRED
          : WEBHOOK_EVENTS.REQUEST_OVERDUE;

      dispatchWebhookEventAsync(
        eventType,
        {
          requestId: candidate.id,
          amount: candidate.amount ? String(candidate.amount) : "0",
          assetCode: candidate.assetCode,
          description: candidate.description,
          status: newStatus,
          dueDate: candidate.dueDate ? candidate.dueDate.toISOString() : null,
          expiresAt: candidate.expiresAt ? candidate.expiresAt.toISOString() : null,
          transitionedAt: now.toISOString(),
        },
        candidate.userId
      );

      // Emit in-app & browser notification exactly once
      try {
        NOTIFY.requestOverdue(
          candidate.description || "Payment Request",
          candidate.amount ? `${candidate.amount} ${candidate.assetCode}` : "Funds",
          candidate.id
        );
      } catch (err) {
        logger.warn("Failed to emit in-app overdue notification", { err });
      }
    } else {
      skipped++;
    }
  }

  return {
    checked: overdueCandidates.length,
    transitioned,
    skipped,
    results,
  };
}

/**
 * Mark a payment request as PAID with its transaction hash.
 * Emits webhook event and notification exactly once (enforced by paidNotifiedAt).
 */
export async function markPaymentRequestPaid(
  requestId: string,
  transactionHash: string,
  now = new Date(),
  prismaClient = prisma
): Promise<{ success: boolean; request?: any; error?: string }> {
  const req = await prismaClient.paymentRequest.findUnique({
    where: { id: requestId },
  });

  if (!req) {
    return { success: false, error: "Payment request not found." };
  }

  // Atomic update: only transition if not already paid and paidNotifiedAt is null
  const updateCount = await prismaClient.paymentRequest.updateMany({
    where: {
      id: requestId,
      status: { not: "PAID" },
      paidNotifiedAt: null,
    },
    data: {
      status: "PAID",
      transactionHash,
      paidNotifiedAt: now,
    },
  });

  if (updateCount.count > 0) {
    const updated = await prismaClient.paymentRequest.findUnique({
      where: { id: requestId },
    });

    logger.info("Payment request marked as paid", {
      id: requestId,
      transactionHash,
    });

    // Emit webhook exactly once
    dispatchWebhookEventAsync(
      WEBHOOK_EVENTS.REQUEST_PAID,
      {
        requestId,
        transactionHash,
        amount: String(req.amount),
        assetCode: req.assetCode,
        description: req.description,
        status: "PAID",
        paidAt: now.toISOString(),
      },
      req.userId
    );

    // Emit in-app notification exactly once
    try {
      NOTIFY.requestPaid(
        req.description || "Payment Request",
        `${req.amount} ${req.assetCode}`,
        transactionHash
      );
    } catch (err) {
      logger.warn("Failed to emit in-app paid notification", { err });
    }

    return { success: true, request: updated };
  }

  return {
    success: true,
    request: req,
    error: "Request has already been processed or marked paid.",
  };
}

/**
 * Send a reminder for an outstanding payment request.
 * Enforces rate limiting, records reminder count, and emits webhook and notification.
 */
export async function sendPaymentRequestReminder(
  requestId: string,
  userId: string,
  now = new Date(),
  prismaClient = prisma
): Promise<{
  success: boolean;
  reminderCount: number;
  lastReminderAt?: Date | null;
  error?: string;
  cooldownRemainingSeconds?: number;
}> {
  const req = await prismaClient.paymentRequest.findFirst({
    where: { id: requestId, userId },
  });

  if (!req) {
    return {
      success: false,
      error: "Payment request not found or unauthorized.",
      reminderCount: 0,
    };
  }

  const check = canSendReminder(req, now);
  if (!check.allowed) {
    return {
      success: false,
      error: check.reason,
      cooldownRemainingSeconds: check.cooldownRemainingSeconds,
      reminderCount: req.reminderCount,
      lastReminderAt: req.lastReminderAt,
    };
  }

  const updated = await prismaClient.paymentRequest.update({
    where: { id: requestId },
    data: {
      reminderCount: { increment: 1 },
      lastReminderAt: now,
    },
  });

  logger.info("Payment request reminder sent", {
    id: requestId,
    count: updated.reminderCount,
  });

  dispatchWebhookEventAsync(
    WEBHOOK_EVENTS.REQUEST_REMINDER_SENT,
    {
      requestId,
      reminderCount: updated.reminderCount,
      lastReminderAt: now.toISOString(),
      recipientAddress: req.recipientAddress,
      amount: String(req.amount),
      assetCode: req.assetCode,
      status: req.status,
    },
    userId
  );

  try {
    NOTIFY.requestReminder(
      req.description || "Payment Request",
      req.recipientAddress || "Recipient",
      updated.reminderCount
    );
  } catch (err) {
    logger.warn("Failed to emit in-app reminder notification", { err });
  }

  return {
    success: true,
    reminderCount: updated.reminderCount,
    lastReminderAt: updated.lastReminderAt,
  };
}
