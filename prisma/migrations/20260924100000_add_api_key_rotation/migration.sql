-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "ApiKey" ADD COLUMN "rotationExpiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "revokedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ApiKey_supersededById_idx" ON "ApiKey"("supersededById");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
