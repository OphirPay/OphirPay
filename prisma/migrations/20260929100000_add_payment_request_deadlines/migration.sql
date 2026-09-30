ALTER TABLE "PaymentRequest"
ADD COLUMN "recipientEmail" TEXT,
ADD COLUMN "notificationEmail" TEXT,
ADD COLUMN "dueDate" TIMESTAMP(3),
ADD COLUMN "lastReminderAt" TIMESTAMP(3);

CREATE INDEX "PaymentRequest_status_dueDate_idx"
ON "PaymentRequest"("status", "dueDate");

CREATE UNIQUE INDEX "PaymentRequest_transactionHash_key"
ON "PaymentRequest"("transactionHash");
