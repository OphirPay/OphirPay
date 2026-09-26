-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "rotatedAt" TIMESTAMP(3),
ADD COLUMN "rotationExpiresAt" TIMESTAMP(3),
ADD COLUMN "rotatedToId" TEXT,
ADD COLUMN "rotatedFromId" TEXT,
ADD COLUMN "revokedAt" TIMESTAMP(3);
