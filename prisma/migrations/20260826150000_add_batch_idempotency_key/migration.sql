-- AlterTable: add idempotency key to batches so retries (issue #170) are
-- deduplicated server-side. A unique composite index on (userId,
-- idempotencyKey) prevents the same user from creating two batches with the
-- same key while keeping the key nullable for batches created before this
-- migration.
ALTER TABLE "Batch" ADD COLUMN "idempotencyKey" TEXT;

-- Unique composite index: one idempotency key per user. NULL keys are
-- excluded by the database so legacy rows never collide.
CREATE UNIQUE INDEX "UserId_idempotencyKey_unique" ON "Batch"("userId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;