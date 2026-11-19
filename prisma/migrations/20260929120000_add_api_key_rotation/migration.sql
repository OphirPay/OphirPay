ALTER TABLE "ApiKey"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "rotatedAt" TIMESTAMP(3),
  ADD COLUMN "rotatedToId" TEXT;

CREATE INDEX "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");
