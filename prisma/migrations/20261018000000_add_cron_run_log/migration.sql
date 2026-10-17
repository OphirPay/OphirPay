-- CreateTable
CREATE TABLE "CronRunLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "picked" INTEGER NOT NULL DEFAULT 0,
    "executed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "prunedLogs" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronRunLog_runId_key" ON "CronRunLog"("runId");

-- CreateIndex
CREATE INDEX "CronRunLog_createdAt_idx" ON "CronRunLog"("createdAt");

-- CreateIndex
CREATE INDEX "CronRunLog_status_idx" ON "CronRunLog"("status");
