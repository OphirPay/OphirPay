-- Add idempotency support to Batch so retried POST /api/batches calls
-- return the original batch instead of duplicating payments.
--
-- The column is nullable: batches created without an Idempotency-Key stay
-- NULL. PostgreSQL treats NULLs as distinct in unique indexes, so the
-- composite unique index below only constrains rows that actually carry a
-- key (one batch per user per key).

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Batch_userId_idempotencyKey_key" ON "Batch"("userId", "idempotencyKey");
