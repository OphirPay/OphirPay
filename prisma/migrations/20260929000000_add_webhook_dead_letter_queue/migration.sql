-- Dead-letter queue for webhook deliveries that exhaust their retry budget
-- (issue #806). A delivery moves to DEAD_LETTER instead of staying FAILED so
-- it is queryable on its own and eligible for bulk redelivery.
ALTER TYPE "DeliveryStatus" ADD VALUE 'DEAD_LETTER';

-- CreateEnum: classified failure reason, so a bounded per-attempt timeout is
-- recorded distinctly from an HTTP-level or connection-level failure instead
-- of being buried in the free-text errorMessage/error columns.
CREATE TYPE "WebhookFailureReason" AS ENUM ('TIMEOUT', 'HTTP_ERROR', 'CONNECTION_ERROR', 'BLOCKED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "failureReason" "WebhookFailureReason",
ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "redeliveryBatchId" TEXT,
ADD COLUMN "redeliveredFromId" TEXT;

-- CreateIndex: powers "unresolved dead letters for this webhook" queries.
CREATE INDEX "WebhookDelivery_webhookId_status_deadLetteredAt_idx" ON "WebhookDelivery"("webhookId", "status", "deadLetteredAt");

-- CreateIndex: correlates every delivery from one bulk redelivery request.
CREATE INDEX "WebhookDelivery_redeliveryBatchId_idx" ON "WebhookDelivery"("redeliveryBatchId");
