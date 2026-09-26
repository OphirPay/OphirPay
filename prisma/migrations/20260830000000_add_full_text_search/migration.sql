-- Issue #823 — Postgres full-text search for payments and audit entries.
--
-- What this migration adds, and why the shape is what it is:
--
--   • Payment.searchVector / AuditLog.searchVector — GENERATED ALWAYS ...
--     STORED tsvector columns. A generated column (rather than a trigger)
--     is preferred here because it cannot drift: there is no code path that
--     can UPDATE the base row and forget to refresh the vector. Postgres
--     requires the generation expression to be IMMUTABLE, which is why the
--     text search configuration is passed explicitly as a regconfig
--     ('english') instead of relying on the session/role default.
--
--   • GIN indexes on the vectors give the query planner a bitmap index scan
--     for @@ matching instead of the sequential scan the previous
--     application-level (ILIKE) path required.
--
--   • Trigram GIN indexes on the raw text columns cover the *partial* term
--     case that a tsvector deliberately does not: tsquery tokens are stemmed
--     whole lexemes, so "inv" only matches "inv:*" via prefix search, while
--     mid-word fragments ("voic" in "invoice") need pg_trgm. Without these,
--     ranking by ts_rank would silently regress a behaviour users already
--     have from the substring search shipped in #157.
--
--   • Partial-index WHERE clauses mirror the application's only read path
--     (rows are soft-deleted with deletedAt, and search is always scoped to
--     a user), keeping the index small and the GIN write cost off rows that
--     can never be returned.
--
-- SQLite development path: this migration is Postgres-only and is skipped by
-- `prisma db push` (documented in docs/DATABASE_SCHEMA_MIGRATIONS.md). The
-- runtime fallback lives in src/lib/full-text-search.ts.

-- pg_trgm is required for the partial-term indexes below. Guarded so that a
-- role without CREATE privilege does not make the whole migration fail hard:
-- the tsvector path (the issue's acceptance criterion) does not depend on it.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'pg_trgm unavailable (insufficient privilege); partial-term trigram indexes skipped. Prefix search via tsquery still works.';
END
$$;

-- ---------------------------------------------------------------------------
-- Payment
-- ---------------------------------------------------------------------------
-- Searchable surface: memo (free text, user-authored), description (free
-- text), transactionHash (opaque, exact-match semantics — see below).
ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("memo", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce("transactionHash", '')), 'A')
  ) STORED;

-- Weights encode the existing contract from #157:
--   A = memo + transactionHash (highest), B = description.
-- 'simple' for the hash keeps it unstemmed so the lexeme is byte-identical
-- to what the user pasted (an "english" stemmer can mangle hex-adjacent
-- tokens), which is what makes exact hash matching reliable.
CREATE INDEX IF NOT EXISTS "Payment_searchVector_idx"
  ON "Payment" USING GIN ("searchVector")
  WHERE "deletedAt" IS NULL;

-- Partial-term coverage. Only created if pg_trgm is actually present.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "Payment_memo_trgm_idx"
    ON "Payment" USING GIN ("memo" gin_trgm_ops)
    WHERE "deletedAt" IS NULL;
  CREATE INDEX IF NOT EXISTS "Payment_description_trgm_idx"
    ON "Payment" USING GIN ("description" gin_trgm_ops)
    WHERE "deletedAt" IS NULL;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'pg_trgm missing at index creation; trigram indexes not created.';
END
$$;

-- Exact-hash lookups stay on a plain B-tree; ts_rank alone is not a
-- guaranteed-correct path for "did this transaction hash exist".
CREATE INDEX IF NOT EXISTS "Payment_transactionHash_idx"
  ON "Payment" ("transactionHash");

-- ---------------------------------------------------------------------------
-- AuditLog
-- ---------------------------------------------------------------------------
-- Searchable surface: details (JSON-in-TEXT payload), actor, action.
-- JSON punctuation is not useful to a tsquery, so `details` is lower-cased
-- and its structural characters are folded to spaces before vectorizing.
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(
      to_tsvector('english',
        regexp_replace(lower(coalesce("details", '')), '[^a-z0-9_]+', ' ', 'g')
      ), 'A') ||
    setweight(to_tsvector('english', coalesce("actor", '')), 'A') ||
    setweight(to_tsvector('simple',  coalesce("action", '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "AuditLog_searchVector_idx"
  ON "AuditLog" USING GIN ("searchVector");

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "AuditLog_actor_trgm_idx"
    ON "AuditLog" USING GIN ("actor" gin_trgm_ops);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'pg_trgm missing at index creation; AuditLog trigram index not created.';
END
$$;
