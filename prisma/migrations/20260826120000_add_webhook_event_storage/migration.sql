-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'FAILED',
    "responseCode" INTEGER,
    "isReplay" BOOLEAN NOT NULL DEFAULT false,
    "replayBatchId" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_userId_createdAt_idx" ON "WebhookEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_userId_event_createdAt_idx" ON "WebhookEvent"("userId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_deliveredAt_idx" ON "WebhookDelivery"("webhookId", "deliveredAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_replayBatchId_idx" ON "WebhookDelivery"("replayBatchId");
