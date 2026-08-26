-- AlterTable: Convert monetary Float columns to Decimal(18,7)
-- This prevents floating-point rounding errors in financial computations.
-- 18 digits total, 7 decimal places = up to 99 billion XLM with stroop-level precision.

ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE DECIMAL(18,7);

ALTER TABLE "Recurrence" ALTER COLUMN "amount" TYPE DECIMAL(18,7);

ALTER TABLE "PaymentRequest" ALTER COLUMN "amount" TYPE DECIMAL(18,7);

ALTER TABLE "Refund" ALTER COLUMN "amount" TYPE DECIMAL(18,7);
