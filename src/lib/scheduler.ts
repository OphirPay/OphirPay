// SPDX-License-Identifier: MIT

import type Prisma from "@prisma/client";

/**
 * Scheduled payment execution helpers (issue #175).
 *
 * The cron endpoint is designed to be safe under overlapping runs: each due
 * recurrence is *claimed* by atomically advancing its `nextRunAt`. Two
 * concurrent invocations can never both observe the same due schedule, so a
 * payment can never be double-executed.
 */

export const CRON_BATCH_LIMIT = 25;

/** Compute the next run time strictly after `from` for a frequency. */
export function nextOccurrence(from: Date, frequency: string): Date {
  const next = new Date(from);
  const addMonths = (months: number) => {
    // Clamp the day-of-month so Jan 31 + MONTHLY lands on Feb 28, not Mar 3.
    const targetMonthIndex = next.getUTCMonth() + months;
    const daysInTargetMonth = new Date(
      Date.UTC(next.getUTCFullYear(), targetMonthIndex + 1, 0)
    ).getUTCDate();
    next.setUTCDate(Math.min(next.getUTCDate(), daysInTargetMonth));
    next.setUTCMonth(targetMonthIndex);
  };
  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "BIWEEKLY":
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case "MONTHLY":
      addMonths(1);
      break;
    case "QUARTERLY":
      addMonths(3);
      break;
    case "YEARLY":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    default:
      // Unknown frequency - push out a day rather than looping forever.
      next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export interface SchedulerPrisma {
  recurrence: {
    findMany(args: {
      where: Record<string, unknown>;
      take: number;
      orderBy: Record<string, string>;
    }): Promise<RecurrenceLike[]>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  payment: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export interface RecurrenceLike {
  id: string;
  userId: string;
  name: string;
  frequency: string;
  amount: Prisma.Prisma.Decimal | number | string;
  assetCode: string;
  destAddress: string;
  description?: string | null;
  nextRunAt: Date;
}

export interface ExecutionResult {
  recurrenceId: string;
  executed: boolean;
  paymentId?: string;
  reason?: string;
}

/**
 * Select due schedules, atomically claim them by advancing `nextRunAt`, then
 * execute each claimed one exactly once.
 */
export async function processDueRecurrences(
  prisma: SchedulerPrisma,
  now: Date,
  limit: number = CRON_BATCH_LIMIT
): Promise<ExecutionResult[]> {
  const due = await prisma.recurrence.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
  });

  const results: ExecutionResult[] = [];

  for (const recurrence of due) {
    // Atomic claim: only succeeds if nextRunAt is still the value we saw.
    // A concurrent runner advancing it first makes our update match 0 rows.
    const claim = await prisma.recurrence.updateMany({
      where: {
        id: recurrence.id,
        isActive: true,
        nextRunAt: recurrence.nextRunAt,
      },
      data: {
        lastRunAt: now,
        nextRunAt: nextOccurrence(now, recurrence.frequency),
      },
    });

    if (claim.count === 0) {
      results.push({
        recurrenceId: recurrence.id,
        executed: false,
        reason: "claimed-by-concurrent-run",
      });
      continue;
    }

    try {
      const payment = await prisma.payment.create({
      data: {
        userId: recurrence.userId,
        amount: recurrence.amount,
        assetCode: recurrence.assetCode,
        description: recurrence.description ?? recurrence.name,
        memo: `scheduled:${recurrence.id}`,
        // Execution model: a server-side cron holds no wallet keys, so it
        // cannot sign a Stellar transaction itself. The scheduler's job is
        // to (1) fire exactly once per schedule and (2) materialize the
        // payment in PENDING with full provenance; the linked wallet then
        // signs and submits it, which records the tx hash and moves the
        // status to COMPLETED/FAILED via the normal payment flow.
        status: "PENDING",
          destAccountId: recurrence.destAddress,
          recurrenceId: recurrence.id,
          metadata: JSON.stringify({
            scheduledExecution: true,
            triggeredAt: now.toISOString(),
            frequency: recurrence.frequency,
          }),
        },
      });

      results.push({
        recurrenceId: recurrence.id,
        executed: true,
        paymentId: payment.id,
      });
    } catch (err) {
      // Roll the claim back so the occurrence is retried on the next run -
      // otherwise an advanced nextRunAt with no payment would skip it forever.
      await prisma.recurrence.updateMany({
        where: { id: recurrence.id, isActive: true },
        data: { lastRunAt: null, nextRunAt: recurrence.nextRunAt },
      });
      results.push({
        recurrenceId: recurrence.id,
        executed: false,
        reason: "payment-creation-failed",
      });
    }
  }

  return results;
}
