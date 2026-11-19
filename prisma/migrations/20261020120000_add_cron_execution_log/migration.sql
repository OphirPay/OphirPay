-- CreateTable: Ephemeral log of a single scheduled payment cron run (issue #1420).
CREATE TABLE "CronExecutionLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "task" TEXT NOT NULL DEFAULT 'all',
    "picked" INTEGER NOT NULL DEFAULT 0,
    "executed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CronExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronExecutionLog_runId_key" ON "CronExecutionLog"("runId");

-- CreateIndex
CREATE INDEX "CronExecutionLog_createdAt_idx" ON "CronExecutionLog"("createdAt");

-- CreateIndex
CREATE INDEX "CronExecutionLog_status_idx" ON "CronExecutionLog"("status");
