-- CreateTable
CREATE TABLE "CronExecutionLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "picked" INTEGER NOT NULL DEFAULT 0,
    "executed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronExecutionLog_runId_key" ON "CronExecutionLog"("runId");

-- CreateIndex
CREATE INDEX "CronExecutionLog_createdAt_idx" ON "CronExecutionLog"("createdAt");
