-- Postgres full-text search for payments and audit entries (issue #823).
--
-- Adds a stored generated `searchVector` tsvector column plus a GIN index to
-- each searchable table so search is an indexed, ranked match instead of a
-- sequential scan / unanchored LIKE. Column weights drive ts_rank:
--   A = exact-identity fields (transaction hash, actor)
--   B = primary human text     (memo, action)
--   C = long free text         (description, JSONB details)
--
-- `IF NOT EXISTS` keeps the migration re-runnable. Indexes are created with a
-- plain CREATE INDEX (not CONCURRENTLY): Prisma wraps each migration in a
-- transaction and CONCURRENTLY cannot run inside one.
--
-- These tsvector columns are intentionally NOT declared in schema.prisma:
-- Prisma has no native tsvector type, and declaring them as
-- Unsupported("tsvector") would make `prisma migrate diff` compare a plain
-- nullable column against a GENERATED ALWAYS ... STORED column and report
-- schema drift on every CI run. Prisma Client never selects them; they are read
-- only through $queryRaw — see src/lib/full-text-search.ts and
-- docs/DATABASE_SCHEMA_MIGRATIONS.md (PostgreSQL Full-Text Search).

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',  coalesce("transactionHash", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("memo", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "Payment_searchVector_idx"
  ON "Payment" USING GIN ("searchVector");

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple',  coalesce("actor", '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce("action", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("details"::text, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "AuditLog_searchVector_idx"
  ON "AuditLog" USING GIN ("searchVector");
