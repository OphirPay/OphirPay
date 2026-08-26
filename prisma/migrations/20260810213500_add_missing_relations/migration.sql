-- AddMissingRelations: Add foreign key indexes for models missing User relations.
-- The relationMode = "prisma" means these are application-level constraints
-- (not database-level FK constraints), but the indexes are still useful for queries.

-- Batch: add userId index for efficient user-scoped queries
CREATE INDEX IF NOT EXISTS "Batch_userId_idx" ON "Batch"("userId");

-- Recurrence: add userId index
CREATE INDEX IF NOT EXISTS "Recurrence_userId_idx" ON "Recurrence"("userId");

-- PaymentRequest: add userId index
CREATE INDEX IF NOT EXISTS "PaymentRequest_userId_idx" ON "PaymentRequest"("userId");
