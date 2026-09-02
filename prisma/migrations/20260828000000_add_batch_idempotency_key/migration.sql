-- AlterTable: add a client-supplied idempotency key to batches (issue #170).
-- A retried batch submission is deduplicated per user via the compound unique
-- constraint (userId, idempotencyKey), so a partially-succeeded first attempt
-- can never be re-submitted into duplicate payments.

ALTER TABLE "Batch" ADD COLUMN "idempotencyKey" TEXT;

-- Unique index scoped per user: two different users may reuse the same key.
CREATE UNIQUE INDEX "Batch_userId_idempotencyKey_key" ON "Batch"("userId", "idempotencyKey");