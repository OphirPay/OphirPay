-- AlterEnum
-- Adds the on-chain lifecycle states used by the payments flow: a payment
-- row moves CREATED → SIGNED → SUBMITTED → CONFIRMED before completing
-- (see src/app/api/payments/[id]/route.ts and the webhook event types).
-- These values were added to schema.prisma without a migration; this
-- migration brings the committed migration history in sync with the schema.
ALTER TYPE "PaymentStatus" ADD VALUE 'SIGNED';
ALTER TYPE "PaymentStatus" ADD VALUE 'SUBMITTED';
ALTER TYPE "PaymentStatus" ADD VALUE 'CONFIRMED';
