-- Full-text search vectors for payments and audit log (issue #823).
--
-- PostgreSQL-only migration: the committed schema is the canonical
-- PostgreSQL definition and migrations run via `migrate deploy`. Local
-- SQLite development uses `db push` (which never applies migrations), so
-- the tsvector columns below do not affect the SQLite path — it keeps the
-- existing LIKE-based search (see src/lib/fts-search.ts fallback).
-- Plain CREATE INDEX (not CONCURRENTLY): Prisma migrations cannot run
-- inside CONCURRENTLY's implicit transaction rules; tables here are small.

-- Payment: memo + description + transaction hash.
ALTER TABLE "Payment" ADD COLUMN "search_vector" TSVECTOR
GENERATED ALWAYS AS (
  to_tsvector('english',
    coalesce("memo", '') || ' ' ||
    coalesce("description", '') || ' ' ||
    coalesce("transactionHash", ''))
) STORED;

CREATE INDEX "Payment_search_vector_idx" ON "Payment" USING GIN ("search_vector");

-- AuditLog: action + actor + details JSON text.
ALTER TABLE "AuditLog" ADD COLUMN "search_vector" TSVECTOR
GENERATED ALWAYS AS (
  to_tsvector('english',
    coalesce("action", '') || ' ' ||
    coalesce("actor", '') || ' ' ||
    coalesce("details"::text, ''))
) STORED;

CREATE INDEX "AuditLog_search_vector_idx" ON "AuditLog" USING GIN ("search_vector");
