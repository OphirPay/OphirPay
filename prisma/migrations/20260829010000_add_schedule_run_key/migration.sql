-- AlterTable: deterministic run identity for the recurring scheduler (issue #366).
-- The unique index is the DB-level at-most-once guarantee: a crashed worker can
-- never double-create the Payment row for one scheduled run.
ALTER TABLE "Payment" ADD COLUMN "scheduleRunKey" TEXT;
CREATE UNIQUE INDEX "Payment_scheduleRunKey_key" ON "Payment"("scheduleRunKey");

-- AlterEnum: scheduled payments awaiting execution.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
