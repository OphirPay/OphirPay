-- AlterTable
ALTER TABLE "WebhookDelivery"
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
