-- Refund idempotency: at most ONE refund row per (user, payment) so
-- duplicate submissions can never create a second refund for the same
-- payment, even under concurrent request races (issue #365).
CREATE UNIQUE INDEX "Refund_userId_paymentId_key" ON "Refund"("userId", "paymentId");

-- CreateTable: persisted off-chain audit trail. The contract keeps its own
-- on-chain audit ledger; this table records refund lifecycle actions with
-- their DB record id so refund history is queryable via GET /api/audit-log.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "target" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Index for history queries by action/target.
CREATE INDEX "AuditLog_action_target_idx" ON "AuditLog"("action", "target");
