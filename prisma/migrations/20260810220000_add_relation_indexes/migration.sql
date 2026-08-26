-- AddRelationIndexes: Add database indexes for all relation fields.
-- With relationMode = "prisma", no foreign key constraints exist at the DB
-- level, so we must add indexes manually to avoid full table scans on joins.

-- Account: userId index
CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");

-- Payment: indexes on all foreign key and frequently-queried columns
CREATE INDEX IF NOT EXISTS "Payment_userId_idx" ON "Payment"("userId");
CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON "Payment"("status");
CREATE INDEX IF NOT EXISTS "Payment_batchId_idx" ON "Payment"("batchId");
CREATE INDEX IF NOT EXISTS "Payment_recurrenceId_idx" ON "Payment"("recurrenceId");
CREATE INDEX IF NOT EXISTS "Payment_sourceAccountId_idx" ON "Payment"("sourceAccountId");
CREATE INDEX IF NOT EXISTS "Payment_destAccountId_idx" ON "Payment"("destAccountId");

-- Batch: status index (userId already exists from prior migration)
CREATE INDEX IF NOT EXISTS "Batch_status_idx" ON "Batch"("status");

-- Recurrence: nextRunAt index (userId already exists from prior migration)
CREATE INDEX IF NOT EXISTS "Recurrence_nextRunAt_idx" ON "Recurrence"("nextRunAt");

-- Webhook: userId index
CREATE INDEX IF NOT EXISTS "Webhook_userId_idx" ON "Webhook"("userId");

-- ApiKey: userId and prefix indexes
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");
CREATE INDEX IF NOT EXISTS "ApiKey_prefix_idx" ON "ApiKey"("prefix");
