-- Persist successful API-key requests so usage can be aggregated by key and time window.
CREATE TABLE "ApiKeyRequestLog" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKeyRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiKeyRequestLog_keyId_createdAt_idx" ON "ApiKeyRequestLog"("keyId", "createdAt");

ALTER TABLE "ApiKeyRequestLog" ADD CONSTRAINT "ApiKeyRequestLog_keyId_fkey"
  FOREIGN KEY ("keyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;