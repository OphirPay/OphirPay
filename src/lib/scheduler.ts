// SPDX-License-Identifier: MIT

/**
 * Scheduling policy for the payment cron (issue #175).
 *
 * Everything in this module is pure and clock-injected: the caller passes the
 * `now` it captured at the start of a run, so the whole due-selection and
 * lease policy can be exercised against a simulated clock in tests.
 *
 * The database is the source of truth for *mutual exclusion* — a run claims a
 * row with a conditional `updateMany` (see `claimWhere`) and only proceeds if
 * exactly one row changed. This module decides *which* rows are worth trying.
 */

import crypto from "crypto";

/** How long a claimed row stays leased before another run may reclaim it. */
export const PROCESSING_LEASE_MS = 5 * 60_000;

/** Upper bound on rows executed per run, so a run fits inside its timeout. */
export const MAX_PAYMENTS_PER_RUN = 25;

/**
 * How many times a due payment is submitted before it is given up on. A
 * failed attempt returns the row to SCHEDULED for the next run until the cap
 * is reached, so a transient Horizon error does not kill the payment.
 */
export const MAX_EXECUTION_ATTEMPTS = 3;

/** Header carrying the cron secret when the caller cannot set `Authorization`. */
export const CRON_SECRET_HEADER = "x-cron-secret";

/** Statuses a run may act on. Terminal rows are never re-queried. */
export const CLAIMABLE_STATUSES = ["SCHEDULED", "PROCESSING"] as const;

export type ClaimableStatus = (typeof CLAIMABLE_STATUSES)[number];

/**
 * The subset of a `ScheduledPayment` row the policy needs. Kept structural so
 * tests can build records without a Prisma client.
 */
export interface SchedulableRecord {
  id: string;
  scheduledAt: Date;
  status: string;
  lockedAt: Date | null;
  attempts: number;
}

export interface DueSelectionOptions {
  /** Wall clock captured once at the start of the run. */
  now: Date;
  /** Maximum rows to return. Defaults to {@link MAX_PAYMENTS_PER_RUN}. */
  limit?: number;
  /** Lease window. Defaults to {@link PROCESSING_LEASE_MS}. */
  leaseMs?: number;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date`);
  }
}

/**
 * Is this row's execution lease expired — i.e. was it claimed by a run that
 * never finished (a crashed or timed-out invocation)?
 */
export function isLeaseExpired(
  record: SchedulableRecord,
  now: Date,
  leaseMs: number = PROCESSING_LEASE_MS
): boolean {
  assertValidDate(now, "now");
  if (!record.lockedAt) return true; // PROCESSING without a lease: orphaned
  return now.getTime() - record.lockedAt.getTime() >= leaseMs;
}

/**
 * Should this run attempt to execute this row?
 *
 * A row is due when its scheduled instant has passed, it has attempts left,
 * and it is either unclaimed (SCHEDULED) or claimed by a run whose lease has
 * expired (PROCESSING). A PROCESSING row inside its lease belongs to another
 * in-flight run and is deliberately left alone.
 */
export function isDue(
  record: SchedulableRecord,
  now: Date,
  leaseMs: number = PROCESSING_LEASE_MS
): boolean {
  assertValidDate(now, "now");
  assertValidDate(record.scheduledAt, "record.scheduledAt");

  if (record.scheduledAt.getTime() > now.getTime()) return false;
  if (record.attempts >= MAX_EXECUTION_ATTEMPTS) return false;
  if (record.status === "SCHEDULED") return true;
  if (record.status === "PROCESSING") return isLeaseExpired(record, now, leaseMs);
  return false;
}

/**
 * Pick the rows this run will try to execute: due rows, oldest schedule
 * first, capped at `limit`. Ties break on id so two concurrent runs walk the
 * candidates in the same order and contend on the same row (one wins the
 * claim, the other moves on) instead of interleaving unpredictably.
 */
export function selectDuePayments<T extends SchedulableRecord>(
  records: readonly T[],
  options: DueSelectionOptions
): T[] {
  const { now, limit = MAX_PAYMENTS_PER_RUN, leaseMs = PROCESSING_LEASE_MS } =
    options;
  assertValidDate(now, "now");
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }

  return records
    .filter((record) => isDue(record, now, leaseMs))
    .sort(
      (a, b) =>
        a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
        a.id.localeCompare(b.id)
    )
    .slice(0, limit);
}

/**
 * Prisma `where` for the candidate query: everything a run could plausibly
 * act on. Deliberately coarse — the lease and attempt policy is applied by
 * {@link selectDuePayments}, and mutual exclusion by {@link claimWhere}.
 */
export function candidateWhere(now: Date) {
  assertValidDate(now, "now");
  return {
    status: { in: [...CLAIMABLE_STATUSES] },
    scheduledAt: { lte: now },
    attempts: { lt: MAX_EXECUTION_ATTEMPTS },
  };
}

/**
 * Prisma `where` for the atomic claim. Applied with `updateMany`, this is a
 * compare-and-set: the row is only taken if it is still unclaimed, or if its
 * lease has genuinely expired. Two overlapping runs racing for the same row
 * both issue this update; exactly one reports `count === 1`, and the loser
 * skips the row — which is what makes the endpoint safe to run concurrently.
 */
export function claimWhere(
  id: string,
  now: Date,
  leaseMs: number = PROCESSING_LEASE_MS
) {
  assertValidDate(now, "now");
  const leaseCutoff = new Date(now.getTime() - leaseMs);
  return {
    id,
    attempts: { lt: MAX_EXECUTION_ATTEMPTS },
    scheduledAt: { lte: now },
    OR: [
      { status: "SCHEDULED" as const },
      {
        status: "PROCESSING" as const,
        OR: [{ lockedAt: null }, { lockedAt: { lte: leaseCutoff } }],
      },
    ],
  };
}

/** Identifier stamped on claimed rows so a lease can be traced to its run. */
export function newRunId(): string {
  return crypto.randomUUID();
}

/**
 * Constant-time secret comparison. Compares digests rather than the raw
 * strings so mismatched lengths do not short-circuit and leak length.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Read the cron secret off a request. Vercel Cron sends the project's
 * `CRON_SECRET` as `Authorization: Bearer <secret>`; the `x-cron-secret`
 * header is accepted too, for external schedulers and for manual runs.
 */
export function readCronSecret(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }
  const header = headers.get(CRON_SECRET_HEADER);
  return header ? header.trim() : null;
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "unauthorized" };

/**
 * Authorize a cron invocation. Missing configuration is reported separately
 * from a bad secret: an unconfigured `CRON_SECRET` is an operator error (503,
 * the endpoint is closed), a wrong secret is a caller error (401).
 */
export function authorizeCronRequest(
  headers: Headers,
  expectedSecret: string | undefined
): CronAuthResult {
  if (!expectedSecret) return { ok: false, reason: "not-configured" };
  const provided = readCronSecret(headers);
  if (!provided) return { ok: false, reason: "unauthorized" };
  return secretsMatch(provided, expectedSecret)
    ? { ok: true }
    : { ok: false, reason: "unauthorized" };
}

/** Default retention window (days) for completed cron execution logs (#1420). */
export const DEFAULT_CRON_LOG_RETENTION_DAYS = 90;

/** Maximum rows deleted in a single cron pruning pass to prevent long PostgreSQL table locks (#1420). */
export const CRON_LOG_PRUNE_BATCH_SIZE = 1000;

/**
 * Terminal statuses eligible for historical cron log pruning.
 * Active (`SCHEDULED`, `PROCESSING`) and `FAILED` rows are NEVER pruned so
 * pending/in-flight schedules and failure diagnostics remain intact.
 */
export const PRUNABLE_CRON_STATUSES = ["EXECUTED", "CANCELLED"] as const;

/**
 * Parse `CRON_LOG_RETENTION_DAYS` from environment, falling back to
 * {@link DEFAULT_CRON_LOG_RETENTION_DAYS} (90 days) when unset or invalid.
 */
export function resolveCronLogRetentionDays(
  rawValue: string | undefined = process.env.CRON_LOG_RETENTION_DAYS
): number {
  if (!rawValue) return DEFAULT_CRON_LOG_RETENTION_DAYS;
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CRON_LOG_RETENTION_DAYS;
  }
  return Math.floor(parsed);
}

/** Compute the UTC cutoff timestamp prior to which completed cron logs may be pruned. */
export function cronLogPruneCutoff(
  now: Date,
  retentionDays: number = DEFAULT_CRON_LOG_RETENTION_DAYS
): Date {
  assertValidDate(now, "now");
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new RangeError("retentionDays must be a positive number");
  }
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

export interface CronLogPruneClient {
  scheduledPayment?: {
    findMany?: (args: {
      where: {
        status: { in: string[] };
        updatedAt: { lt: Date };
      };
      select: { id: true };
      orderBy: { updatedAt: "asc" };
      take: number;
    }) => Promise<Array<{ id: string }>>;
    deleteMany?: (args: {
      where: {
        id: { in: string[] };
        status: { in: string[] };
      };
    }) => Promise<{ count: number }>;
  };
  paymentSyncRun?: {
    findMany?: (args: {
      where: {
        status: string;
        completedAt: { lt: Date };
      };
      select: { id: true };
      orderBy: { completedAt: "asc" };
      take: number;
    }) => Promise<Array<{ id: string }>>;
    deleteMany?: (args: {
      where: {
        id: { in: string[] };
        status: string;
      };
    }) => Promise<{ count: number }>;
  };
}

export interface CronLogPruneOptions {
  now: Date;
  retentionDays?: number;
  batchSize?: number;
}

export interface CronLogPruneResult {
  prunedCount: number;
  scheduledPaymentsPruned: number;
  syncRunsPruned: number;
  retentionDays: number;
  cutoff: string;
}

/**
 * Prune completed cron execution logs older than `retentionDays` (default 90d)
 * in bounded batches (`LIMIT 1000`). Active (`SCHEDULED`, `PROCESSING`),
 * `FAILED` rows, and recurring schedules (`Recurrence`) are never deleted.
 */
export async function pruneExpiredCronLogs(
  db: CronLogPruneClient,
  options: CronLogPruneOptions
): Promise<CronLogPruneResult> {
  const retentionDays =
    options.retentionDays ?? resolveCronLogRetentionDays();
  const batchSize = options.batchSize ?? CRON_LOG_PRUNE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("batchSize must be a positive integer");
  }

  const cutoff = cronLogPruneCutoff(options.now, retentionDays);
  let scheduledPaymentsPruned = 0;
  let syncRunsPruned = 0;

  if (
    typeof db?.scheduledPayment?.findMany === "function" &&
    typeof db?.scheduledPayment?.deleteMany === "function"
  ) {
    const expiredScheduled = await db.scheduledPayment.findMany({
      where: {
        status: { in: [...PRUNABLE_CRON_STATUSES] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: batchSize,
    });

    if (expiredScheduled.length > 0) {
      const deleted = await db.scheduledPayment.deleteMany({
        where: {
          id: { in: expiredScheduled.map((r) => r.id) },
          status: { in: [...PRUNABLE_CRON_STATUSES] },
        },
      });
      scheduledPaymentsPruned = deleted.count;
    }
  }

  const remainingBudget = Math.max(0, batchSize - scheduledPaymentsPruned);
  if (
    remainingBudget > 0 &&
    typeof db?.paymentSyncRun?.findMany === "function" &&
    typeof db?.paymentSyncRun?.deleteMany === "function"
  ) {
    const expiredSyncRuns = await db.paymentSyncRun.findMany({
      where: {
        status: "success",
        completedAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { completedAt: "asc" },
      take: remainingBudget,
    });

    if (expiredSyncRuns.length > 0) {
      const deleted = await db.paymentSyncRun.deleteMany({
        where: {
          id: { in: expiredSyncRuns.map((r) => r.id) },
          status: "success",
        },
      });
      syncRunsPruned = deleted.count;
    }
  }

  return {
    prunedCount: scheduledPaymentsPruned + syncRunsPruned,
    scheduledPaymentsPruned,
    syncRunsPruned,
    retentionDays,
    cutoff: cutoff.toISOString(),
  };
}

