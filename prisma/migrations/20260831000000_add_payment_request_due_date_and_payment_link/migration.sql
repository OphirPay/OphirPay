-- Add optional due date to payment requests (bounty #364: invoice-style
-- requests with expiry) and link payments back to the request they fulfill
-- (enables request.paid marking + notification when a payer sends funds).

ALTER TABLE "PaymentRequest" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "requestId" TEXT;

-- FK: payment.requestId → paymentRequest.id (nullable, one request : many payments)
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for "payments for a request" lookups
CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");

-- Index for "due soon / expired requests" lookups
CREATE INDEX "PaymentRequest_dueDate_idx" ON "PaymentRequest"("dueDate");
