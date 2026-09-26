-- Migration: Add Postgres full-text search with stored generated tsvector columns and GIN indexes
-- Issue #823: Add Postgres full-text search for payments and audit entries

-- 1. Payment searchVector and GIN index
-- Stored generated column combining transactionHash (weight A), memo (weight B), and description (weight C).
ALTER TABLE "Payment"
ADD COLUMN IF NOT EXISTS "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("transactionHash", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("memo", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'C')
) STORED;

CREATE INDEX IF NOT EXISTS "Payment_searchVector_idx" ON "Payment" USING GIN ("searchVector");

-- 2. AuditLog searchVector and GIN index
-- Stored generated column combining actor (weight A), action (weight B), and details (weight C).
ALTER TABLE "AuditLog"
ADD COLUMN IF NOT EXISTS "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("actor", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("action", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("details"::text, '')), 'C')
) STORED;

CREATE INDEX IF NOT EXISTS "AuditLog_searchVector_idx" ON "AuditLog" USING GIN ("searchVector");
