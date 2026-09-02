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
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledPaymentStatus" NOT NULL DEFAULT 'SCHEDULED',
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
CREATE INDEX "ScheduledPayment_status_scheduledFor_idx" ON "ScheduledPayment"("status", "scheduledFor");
