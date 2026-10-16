// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { incCronLogsPruned } from "@/lib/metrics-counters";

/**
 * Automated Cron Execution Log Retention & Pruning (issue #1420).
 *
 * The scheduled payment cron handler `/api/cron` executes periodically.
 * Ephemeral run records are kept in PostgreSQL for 90 days for operational
 * observability and troubleshooting. To prevent database table bloat and
 * long index maintenance locks:
 *
 *   1. Records older than 90 days are pruned in batches of 1,000.
 *   2. Deletions execute in scoped transactions with ID selection to avoid
 *      table-level exclusive locks.
 *   3. Critical entities (Recurrence schedules, active/failed ScheduledPayment
 *      records) are never touched by this retention policy.
 *   4. Pruned row counts increment `ophirpay_cron_logs_pruned_total`.
 */

export const CRON_LOG_RETENTION_DAYS = 90;
export const PRUNE_BATCH_SIZE = 1_000;
export const DEFAULT_MAX_BATCHES = 50;

export interface PruneOptions {
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
  maxBatches?: number;
}

export interface PruneResult {
  prunedCount: number;
  batchesExecuted: number;
  cutoff: Date;
}

/**
 * Prune ephemeral cron execution logs older than the retention window.
 * Deletes rows in batches of `batchSize` (default 1,000) inside transactions.
 */
export async function pruneCronExecutionLogs(
  options: PruneOptions = {}
): Promise<PruneResult> {
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? CRON_LOG_RETENTION_DAYS;
  const batchSize = options.batchSize ?? PRUNE_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  let totalPruned = 0;
  let batches = 0;

  try {
    while (batches < maxBatches) {
      // Step 1: Select IDs of stale rows to avoid range locks across the whole table.
      const staleRows = await (prisma as any).cronExecutionLog.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: batchSize,
      });

      if (!staleRows || staleRows.length === 0) {
        break;
      }

      const ids = staleRows.map((row: { id: string }) => row.id);

      // Step 2: Delete by explicit IDs within a transaction block.
      await (prisma as any).$transaction([
        (prisma as any).cronExecutionLog.deleteMany({
          where: { id: { in: ids } },
        }),
      ]);

      const count = ids.length;
      totalPruned += count;
      batches += 1;
      incCronLogsPruned(count);

      logger.info("Pruned batch of stale cron execution logs", {
        batch: batches,
        prunedInBatch: count,
        totalPruned,
        cutoff: cutoff.toISOString(),
      });

      if (count < batchSize) {
        break;
      }
    }
  } catch (err) {
    logger.error("Failed to prune cron execution logs", {
      error: err instanceof Error ? err.message : String(err),
      totalPrunedSoFar: totalPruned,
    });
    throw err;
  }

  return {
    prunedCount: totalPruned,
    batchesExecuted: batches,
    cutoff,
  };
}

/**
 * Record a completed cron execution run cycle.
 */
export async function recordCronExecution(params: {
  runId: string;
  picked: number;
  executed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  error?: string;
  createdAt?: Date;
}): Promise<void> {
  try {
    await (prisma as any).cronExecutionLog.create({
      data: {
        runId: params.runId,
        picked: params.picked,
        executed: params.executed,
        failed: params.failed,
        skipped: params.skipped,
        durationMs: params.durationMs,
        error: params.error,
        createdAt: params.createdAt ?? new Date(),
      },
    });
  } catch (err) {
    // Non-fatal: logging the run must not fail the scheduled payment response.
    logger.warn("Failed to persist cron execution log", {
      runId: params.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
