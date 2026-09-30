# Database Provider Compatibility

OphirPay uses PostgreSQL as its canonical database in CI and production.
SQLite is a best-effort local-development option, not a production-equivalent
provider. This guide describes the provider differences, the migration boundary,
and a cautious data-transfer process.

## Provider selection

`DATABASE_URL` chooses the connection URL. `DATABASE_PROVIDER` is read by the
application for provider-aware configuration, but it does **not** switch the
Prisma connector: the committed `prisma/schema.prisma` datasource is statically
set to `postgresql`. Setting `DATABASE_PROVIDER=sqlite` alone therefore does
not make Prisma use SQLite.

The SQLite procedure in [Local Development](LOCAL_DEV.md) requires local,
uncommitted schema edits. Keep the committed PostgreSQL schema and migration
history unchanged. For production-like development, CI reproduction, and any
work involving migrations, use PostgreSQL.

## What changes on SQLite

| Area | PostgreSQL (canonical) | SQLite local-development consequence |
|---|---|---|
| Concurrent writes | Multiple writers are coordinated by PostgreSQL. | SQLite serializes writes; overlapping requests, workers, or tests can contend for the database lock. It is not a useful load/concurrency test and does not reproduce production contention behavior. |
| Transactions | Prisma transactions run against PostgreSQL transaction and locking semantics. | SQLite supports transactions, but permits only one writer at a time. A transaction that succeeds locally is not evidence that races, lock behavior, or throughput are correct on PostgreSQL. |
| Enums | Native PostgreSQL enum types are created and altered by migrations. | Prisma represents enum values as text with client-side validation. Raw SQL or other writers can store values Prisma would reject. |
| Monetary values | The five `Decimal` amounts use `@db.Decimal(18, 7)`, preserving the database precision contract. | SQLite has no fixed-precision decimal storage. The local instructions remove the native annotation; do not rely on SQLite arithmetic or SQLite tests to prove rounding and precision behavior. Keep monetary calculations in the application's Decimal code. |
| Scalar lists | `ApiKey.scopes` is a PostgreSQL `String[]`. | Prisma scalar lists are not supported by the SQLite connector. The checked-in model cannot be treated as a fully equivalent SQLite schema; API-key scope behavior requires PostgreSQL. |
| Full-text search | PostgreSQL migration `20260925120000_add_full_text_search` creates generated `tsvector` columns and GIN indexes. | SQLite has neither `tsvector` nor GIN. The migration and PostgreSQL-ranked search path cannot be used; the local substring fallback has fewer ranking/prefix capabilities and is not a performance substitute. |
| Raw SQL | PostgreSQL-specific expressions and DDL are available. | PostgreSQL syntax such as `::text`, `ILIKE`, `to_tsquery`, `ts_rank`, `tsvector`, `GIN`, `ALTER TYPE`, and array literals does not port to SQLite. Keep raw SQL on provider-specific branches and bind values rather than interpolating input. |
| Referential integrity | Application relations use Prisma's `relationMode = "prisma"`; database enforcement is not generally provided by foreign keys. | Prisma emulates relation behavior for supported client operations. Direct SQL/imports can bypass it on either provider, so validate references during data transfer. |

Use SQLite for UI work, small local experiments, and code paths that do not
depend on provider-specific behavior. Use PostgreSQL for migration testing,
concurrency-sensitive paths (idempotency, schedulers, batch processing),
monetary precision, API-key scopes, full-text search, and production parity.

## Migration workflow and the 18 committed migrations

The committed `prisma/migrations/migration_lock.toml` names PostgreSQL, and the
migration history is authored for PostgreSQL. `npx prisma migrate deploy` is
**not a supported SQLite migration workflow**: none of the 18 migrations is an
approved migration for a SQLite database, even where an individual SQL file
uses portable syntax. SQLite development uses `npx prisma db push` against the
locally adjusted schema; it does not apply or record this PostgreSQL history.

For clarity, seven files contain SQL that is portable to SQLite in isolation.
That does not make them a usable subset: earlier migrations are required, the
provider lock is PostgreSQL, and the complete sequence does not apply on
SQLite.

| Migration | SQLite assessment |
|---|---|
| `20260810210941_initial_migration` | PostgreSQL-only: creates native enum types and uses PostgreSQL column types. |
| `20260810212500_fix_amount_decimal` | PostgreSQL-only: `ALTER COLUMN ... TYPE DECIMAL(18,7)` is not SQLite `ALTER TABLE` syntax. |
| `20260810213500_add_missing_relations` | SQL is portable in isolation (indexes only). |
| `20260810220000_add_relation_indexes` | SQL is portable in isolation (indexes only). |
| `20260811120000_add_refund_hook_onchain_id` | SQL is portable in isolation (add columns and unique indexes). |
| `20260826120000_add_webhook_event_storage` | PostgreSQL-only: creates a native enum type. |
| `20260826130000_add_delivery_latency_attempts` | Not SQLite-compatible: adds several columns in one `ALTER TABLE`. |
| `20260826140000_add_payment_idempotency_key` | SQL is portable in isolation (one text column). |
| `20260827000000_add_apikey_scopes` | PostgreSQL-only: `TEXT[]` and `ARRAY[]::TEXT[]`. |
| `20260827000000_add_batch_idempotency_key` | SQL is portable in isolation (nullable text column and unique index). |
| `20260827120000_add_api_key_request_logs` | Not SQLite-compatible: adds a foreign-key constraint with `ALTER TABLE ... ADD CONSTRAINT`. |
| `20260827120000_add_paymentsync_run` | SQL is portable in isolation (table and indexes). |
| `20260828120000_add_scheduled_payments` | PostgreSQL-only: creates a native enum type. |
| `20260829000000_add_payment_status_lifecycle_values` | PostgreSQL-only: `ALTER TYPE ... ADD VALUE`. |
| `20260829000000_add_refund_idempotency_and_audit_log` | SQL is portable in isolation, but SQLite's flexible `JSONB` affinity is not PostgreSQL JSONB behavior. |
| `20260829010000_add_schedule_run_key` | PostgreSQL-only overall: includes `ALTER TYPE ... ADD VALUE`, despite its preceding column/index being portable. |
| `20260925000000_add_webhook_deliveries` | Not SQLite-compatible: adds several columns in one `ALTER TABLE`. |
| `20260925120000_add_full_text_search` | PostgreSQL-only: generated `tsvector` expressions and GIN indexes. |

For PostgreSQL, use the checked-in workflow in
[Database Schema & Migration Guide](DATABASE_SCHEMA_MIGRATIONS.md) and validate
the whole history with `npm run db:validate:migrations` and the PostgreSQL CI
job. Do not cherry-pick the portable-SQL entries into a SQLite migration
history.

### Pooled PostgreSQL URLs

Prisma migration commands need a direct PostgreSQL connection when the runtime
URL is behind a pooler. In the committed schema, `directUrl` is currently
commented out, so `DIRECT_DATABASE_URL` by itself does not redirect Prisma CLI
commands; `DATABASE_URL` is the active datasource URL. For a migration command,
point `DATABASE_URL` at the direct (non-pooled) connection, or first configure
and validate Prisma's `directUrl` in the schema. Do not assume that merely
setting `DIRECT_DATABASE_URL` changes the URL used by the current schema.

## Moving data between providers

There is no checked-in cross-provider migration/export tool. `prisma migrate`
does not copy data between SQLite and PostgreSQL, and copying a SQLite database
file to PostgreSQL is not possible. Treat the move as a data import, not a
schema migration:

1. **Choose a PostgreSQL target and stop writes.** For a production move,
   schedule a maintenance window and stop app instances, cron jobs, and
   background workers that can write to either database.
2. **Back up both sides.** Use SQLite's `.backup` command (or copy the file
   only while no process has it open) and `pg_dump` for PostgreSQL. Keep the
   original SQLite file unchanged until verification is complete.
3. **Create the PostgreSQL schema first.** Apply all committed migrations to a
   fresh PostgreSQL database with `npx prisma migrate deploy`. Use a direct
   URL for the CLI as described above.
4. **Export rows logically.** Export each shared model's data as CSV or JSON
   with explicit column lists. Preserve text IDs, enum labels, ISO timestamps,
   Decimal values as decimal strings, and JSON values. Do not export generated
   PostgreSQL-only `searchVector` columns.
5. **Import in dependency order.** Load parent/user rows before rows that refer
   to them, then verify that every referenced ID exists. Transform SQLite's
   representation of any locally adapted fields (especially API-key scopes)
   to the PostgreSQL column type. Import into a fresh target; do not use a
   generic full-table copy that silently drops or coerces columns.
6. **Verify before switching traffic.** Compare per-table row counts, required
   unique keys, nullability, enum values, and payment amounts. Run the
   PostgreSQL test suite and exercise idempotency, scheduled jobs, search, and
   API-key authorization. Keep the source backup until the new deployment has
   been observed healthy.

For example, SQLite's CLI can export one table using `.headers on`, `.mode
csv`, and `.once <file>` followed by a `SELECT` with an explicit column list;
`psql`'s `\copy` can load that CSV into matching PostgreSQL columns. Repeat
per table only after comparing the source and target column lists. CSV is a
transport format, not a schema/type converter: review escaping, timestamps,
JSON, decimal text, enum values, and locally adapted fields before importing.

The reverse direction also requires a logical export/import and schema
transformation. Do not try to apply PostgreSQL migrations to SQLite or use a
PostgreSQL dump as SQLite SQL.

## Local development checklist

- Keep the committed datasource PostgreSQL and retain all five
  `@db.Decimal(18, 7)` annotations.
- SQLite requires local-only schema changes; `DATABASE_PROVIDER=sqlite` alone
  is insufficient.
- The PostgreSQL migrations and the `ApiKey.scopes` scalar list are not
  supported by SQLite; use PostgreSQL whenever those features matter.
- Before opening a database-related PR, run the migration validation and
  PostgreSQL tests described in [PRISMA-CI.md](PRISMA-CI.md).
