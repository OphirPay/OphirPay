-- CreateTable
CREATE TABLE "PaymentSyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "notFound" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentSyncRun_trigger_idx" ON "PaymentSyncRun"("trigger");

-- CreateIndex
CREATE INDEX "PaymentSyncRun_status_idx" ON "PaymentSyncRun"("status");

-- CreateIndex
CREATE INDEX "PaymentSyncRun_createdAt_idx" ON "PaymentSyncRun"("createdAt");