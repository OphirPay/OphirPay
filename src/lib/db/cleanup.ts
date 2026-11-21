// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { incIdempotencyKeysPruned } from "@/lib/metrics-counters";
import prisma from "@/lib/prisma";

/** Default retention period for idempotency keys: 7 days (issue #2025). */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

/** Default batch size for pruning expired records to prevent database lock contention. */
export const IDEMPOTENCY_CLEANUP_BATCH_SIZE = 1000;

export interface CleanupExpiredIdempotencyKeysOptions {
  /** Reference timestamp for determining expiration (defaults to new Date()). */
  now?: Date;
  /** Bounded batch size for deletions. */
  batchSize?: number;
}

export interface CleanupExpiredIdempotencyKeysResult {
  deletedCount: number;
  batches: number;
  cutoff: Date;
}

/**
 * Lightweight database cleanup routine to delete idempotency tokens older than expiration (issue #2025).
 * Executes `prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } })`
 *
 * Removes expired records efficiently while preserving active keys.
 */
export async function cleanupExpiredIdempotencyKeys(
  options: CleanupExpiredIdempotencyKeysOptions = {}
): Promise<CleanupExpiredIdempotencyKeysResult> {
  const now = options.now ?? new Date();

  const deleteResult = await prisma.idempotencyKey.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });

  const deletedCount = deleteResult.count;
  const batches = deletedCount > 0 ? 1 : 0;

  if (deletedCount > 0) {
    incIdempotencyKeysPruned(deletedCount);
    logger.info("Expired idempotency keys cleaned up", {
      deletedCount,
      cutoff: now.toISOString(),
    });
  }

  return {
    deletedCount,
    batches,
    cutoff: now,
  };
}
