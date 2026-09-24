-- Webhook dead-letter state: exhausted deliveries move out of FAILED into
-- an explicit, queryable DEAD_LETTERED state that retains the failure reason
-- (issue #806). Existing FAILED rows are untouched.

ALTER TYPE "DeliveryStatus" ADD VALUE 'DEAD_LETTERED';

ALTER TABLE "WebhookDelivery" ADD COLUMN "deadLetterReason" TEXT,
ADD COLUMN "deadLetteredAt" TIMESTAMP(3);

CREATE INDEX "WebhookDelivery_webhookId_status_deadLetteredAt_idx" ON "WebhookDelivery"("webhookId", "status", "deadLetteredAt");
