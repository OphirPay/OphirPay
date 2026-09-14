-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "latencyMs" INTEGER,
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "errorMessage" TEXT;
