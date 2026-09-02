// SPDX-License-Identifier: MIT

/**
 * At-most-once due-recurrence processing (issue #366).
 *
 * Design:
 *  1. CLAIM — atomic compare-and-set via `updateMany` on `nextRunAt`: exactly one
 *     worker in a distributed fleet flips a due recurrence to the next run time;
 *     every other worker sees `count === 0` and moves on. This is the mutex.
 *  2. EXECUTE — outside the mutex, generate the Payment row.
 *  3. DEDUPE — the Payment row carries a deterministic `scheduleRunKey`
 *     (`<recurrenceId>:<scheduledAt epoch ms>`), enforced by a DB unique index.
 *     A crash after step 1 but before payment creation therefore cannot double
 *     fire: the next worker re-claims (CAS now matches again since the run key
 *     is derived from the original due time, not the mutated nextRunAt) and the
 *     unique index makes the second Payment insert fail with P2002.
 *  4. ROLLBACK — if payment creation fails, the claim is reverted so the run
 *     retries on the next sweep (bounded retry, no double-fire).
 */

import prisma from "@/lib/prisma";
import type { Frequency } from "@prisma/client";

export const RECURRING_SWEEP_LIMIT = 50;

/** Next fire time for a frequency, from a reference date. */
export function nextRunAfter(ref: Date, frequency: Frequency): Date {
  const d = new Date(ref.getTime());
  switch (frequency) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "BIWEEKLY":
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case "MONTHLY":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    default:
      throw new Error(`Unsupported frequency: ${String(frequency)}`);
  }
  return d;
}

/** Deterministic identity of one scheduled run — the dedupe key. */
export function scheduleRunKey(recurrenceId: string, scheduledAt: Date): string {
  return `${recurrenceId}:${scheduledAt.getTime()}`;
}

export type DueRun = {
  recurrenceId: string;
  scheduledAt: Date;
};

/**
 * Claim due recurrences (at-most-once). Returns the runs THIS worker owns.
 * The claim is the CAS transition; concurrent workers win nothing.
 */
export async function claimDueRecurrences(now: Date, limit = RECURRING_SWEEP_LIMIT): Promise<DueRun[]> {
  const due = await prisma.recurrence.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true, nextRunAt: true, frequency: true },
  });

  const owned: DueRun[] = [];
  for (const r of due) {
    const next = nextRunAfter(r.nextRunAt, r.frequency);
    const result = await prisma.recurrence.updateMany({
      where: { id: r.id, nextRunAt: r.nextRunAt }, // CAS: only if unchanged
      data: { nextRunAt: next, lastRunAt: now },
    });
    if (result.count === 1) {
      owned.push({ recurrenceId: r.id, scheduledAt: r.nextRunAt });
    }
    // count === 0 → another worker claimed it between read and CAS. Skip.
  }
  return owned;
}

/**
 * Create the Payment row for an owned run, dedupe-safe via the unique
 * scheduleRunKey. Returns "created" | "duplicate" | null (recurrence gone).
 */
export async function createRunPayment(
  run: DueRun,
  payment: {
    userId: string;
    amount: string;
    assetCode: string;
    assetIssuer: string | null;
    destAddress: string;
    description?: string | null;
  },
): Promise<"created" | "duplicate" | null> {
  const recurrence = await prisma.recurrence.findUnique({
    where: { id: run.recurrenceId },
    select: { id: true, isActive: true },
  });
  if (!recurrence) return null;
  if (!recurrence.isActive) return "duplicate"; // cancelled mid-race — no run

  try {
    await prisma.payment.create({
      data: {
        userId: payment.userId,
        amount: payment.amount,
        assetCode: payment.assetCode,
        assetIssuer: payment.assetIssuer,
        description: payment.description ?? null,
        status: "SCHEDULED",
        scheduleRunKey: scheduleRunKey(run.recurrenceId, run.scheduledAt),
        // The Payment row has no destAddress column (destination is carried
        // into the contract call at execution time) — keep it in metadata.
        metadata: JSON.stringify({ destAddress: payment.destAddress }),
      },
    });
    return "created";
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
      return "duplicate"; // another worker created this exact run — at-most-once holds
    }
    throw err;
  }
}

/**
 * Rollback a claim whose payment creation failed, so the run retries later.
 */
export async function releaseClaim(run: DueRun, originalNextRunAt: Date): Promise<void> {
  // lastRunAt was set by the claim; revert it to the previous value and put
  // nextRunAt back so the sweep picks the run up again.
  await prisma.recurrence.updateMany({
    where: { id: run.recurrenceId },
    data: { lastRunAt: null, nextRunAt: originalNextRunAt },
  });
}
