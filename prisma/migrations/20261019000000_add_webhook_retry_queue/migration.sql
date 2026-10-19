-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'RETRYING';

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
