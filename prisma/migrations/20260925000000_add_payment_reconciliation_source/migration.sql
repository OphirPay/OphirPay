-- AlterTable: Mechanism that produced the terminal status (issue #819).
-- Allows comparing real-time streaming against periodic polling reconciliation.
ALTER TABLE "Payment" ADD COLUMN "reconciliationSource" TEXT;
