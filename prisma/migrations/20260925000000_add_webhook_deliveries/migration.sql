ALTER TABLE "WebhookDelivery" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "targetUrl" TEXT,
ADD COLUMN "canonicalBody" TEXT,
ADD COLUMN "requestBody" TEXT,
ADD COLUMN "signature" TEXT,
ADD COLUMN "requestHeaders" TEXT,
ADD COLUMN "responseBody" TEXT,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "error" TEXT;
