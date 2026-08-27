-- Add idempotency key support to Batch (issue #170)
ALTER TABLE "Batch" ADD COLUMN "idempotencyKey" TEXT;

-- Enforce one batch per (user, key) pair; NULL keys are exempt from uniqueness
CREATE UNIQUE INDEX "Batch_userId_idempotencyKey_key" ON "Batch"("userId", "idempotencyKey");
