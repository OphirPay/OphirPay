-- Migration: Add Postgres full-text search vectors and GIN indexes for Payment and AuditLog (issue #823).
-- Enables ranked matching over searchable fields while keeping index creation safe.

-- Add tsvector generated column to Payment (transactionHash [A], memo [B], description [C])
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("transactionHash", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("memo", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'C')
) STORED;

-- Create GIN index on Payment searchVector
CREATE INDEX IF NOT EXISTS "Payment_searchVector_idx" ON "Payment" USING GIN ("searchVector");

-- Add tsvector generated column to AuditLog (actor [A], action [B], details [C])
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("actor", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("action", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("details"::text, '')), 'C')
) STORED;

-- Create GIN index on AuditLog searchVector
CREATE INDEX IF NOT EXISTS "AuditLog_searchVector_idx" ON "AuditLog" USING GIN ("searchVector");
