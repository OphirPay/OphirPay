-- SPDX-License-Identifier: MIT
-- Dead-letter queue for webhook deliveries that exhaust their retry budget.

CREATE TABLE "webhook_dead_letters" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastResponseCode" INTEGER,
    "lastErrorMessage" TEXT,
    "failureReason" TEXT,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayedAt" TIMESTAMP(3),
    "replayDeliveryId" TEXT,
    "alertNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_dead_letters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_dead_letters_deliveryId_key" ON "webhook_dead_letters"("deliveryId");
CREATE INDEX "webhook_dead_letters_webhookId_failedAt_idx" ON "webhook_dead_letters"("webhookId", "failedAt");
CREATE INDEX "webhook_dead_letters_replayedAt_idx" ON "webhook_dead_letters"("replayedAt");
