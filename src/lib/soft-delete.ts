// SPDX-License-Identifier: MIT

/**
 * Soft-delete pattern for Prisma models.
 * Instead of permanently deleting records, mark them as deleted
 * and filter them from queries. This preserves data integrity and audit trails.
 *
 * Usage:
 *   await softDelete(prisma.payment, "id-123");
 *   await softDelete(prisma.batch, "batch-456");
 */

// A minimal interface for models that support soft deletion
interface SoftDeletable {
  delete: (args: { where: { id: string } }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
}

/** Models that support soft-deletion should have a 'deletedAt' DateTime field. */
export async function softDelete(delegate: SoftDeletable, id: string): Promise<void> {
  await delegate.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

/** Models that support restoration should undo the soft-delete. */
export async function restore(delegate: SoftDeletable, id: string): Promise<void> {
  await delegate.update({
    where: { id },
    data: { deletedAt: null },
  });
}

/**
 * Prisma middleware-like filter that excludes soft-deleted records.
 * To use: pass `where: { deletedAt: null }` in all queries for affected models.
 */
export const notDeleted = { deletedAt: null } as const;

/**
 * Check if a record has been soft-deleted.
 */
export function isSoftDeleted(record: { deletedAt?: Date | null }): boolean {
  return record.deletedAt != null;
}
