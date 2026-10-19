-- Cursor (keyset) pagination for the persisted audit trail (#1361).
--
-- GET /api/audit-log?source=db used to page with `skip: (page - 1) * limit`,
-- which forces Postgres to scan and discard every skipped row — deep pages get
-- progressively worse on enterprise accounts with tens of thousands of entries.
-- The route now resumes *after* the last row of the previous page using the
-- composite (createdAt, id) ordering, which needs a matching index to keep every
-- page O(1) regardless of depth.

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");
