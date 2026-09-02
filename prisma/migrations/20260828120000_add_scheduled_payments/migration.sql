-- CreateTable: one-off payments queued for a future date, executed by the
-- Vercel cron endpoint (/api/cron, issue #175). The (status, scheduledAt)
-- index serves the cron's due-selection query, and the lease columns
-- (lockedAt/lockedBy) let a run claim a row atomically so overlapping runs
-- never submit the same payment twice.

-- CreateEnum
CREATE TYPE "ScheduledPaymentStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ScheduledPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(18,7) NOT NULL,
    "assetCode" TEXT NOT NULL DEFAULT 'XLM',
    "assetIssuer" TEXT,
    "destAddress" TEXT NOT NULL,
    "memo" TEXT,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledPaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "transactionHash" TEXT,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledPayment_userId_idx" ON "ScheduledPayment"("userId");

-- CreateIndex
CREATE INDEX "ScheduledPayment_status_scheduledAt_idx" ON "ScheduledPayment"("status", "scheduledAt");
