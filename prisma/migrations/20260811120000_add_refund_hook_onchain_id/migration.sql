-- AlterTable: link DB ledger rows to their on-chain Soroban records.
-- The contract's request_refund / register_hook return a u64 id; storing it
-- lets the UI call approve/process/deactivate against the correct contract
-- record instead of treating every DB row as off-chain.

ALTER TABLE "Refund" ADD COLUMN "onChainId" INTEGER;

ALTER TABLE "NotificationHook" ADD COLUMN "onChainId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Refund_onChainId_key" ON "Refund"("onChainId");

CREATE UNIQUE INDEX "NotificationHook_onChainId_key" ON "NotificationHook"("onChainId");
