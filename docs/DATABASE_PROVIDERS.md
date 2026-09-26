# Database Providers — PostgreSQL and SQLite

OphirPay runs **PostgreSQL everywhere it is deployed**. SQLite exists so a
contributor can work locally without a database server, and the two are **not
interchangeable**. This document states the supported matrix, what actually
differs, the commands for each provider, and the things that fail silently.

For the step-by-step local setup, see [`LOCAL_DEV.md`](./LOCAL_DEV.md). This
document is the reference for *what differs and why*; that one is the
walkthrough.

## Supported combinations

| Environment | Provider | How the schema is applied | Status |
|---|---|---|---|
| Production (Vercel) | PostgreSQL | `npx prisma migrate deploy` | Supported — the only deployed configuration |
| CI | PostgreSQL | `prisma migrate deploy` against the service container | Supported |
| Local, production parity | PostgreSQL (Neon, or a local server) | `prisma migrate deploy` | Supported — recommended for migration work |
| Local, quick UI work | SQLite | `npx prisma db push` (no migrations) | Supported, with the caveats below |
| SQLite in production | — | — | **Not supported.** No migration path is provided or tested. |

## Migrations do not apply to SQLite

This is the single most important difference. `prisma/migrations/` contains **16 migrations**, and **4 of them contain PostgreSQL syntax that SQLite cannot
parse**. `prisma migrate deploy` / `migrate dev` against SQLite will fail on
those four — which is why the SQLite path uses `db push` (schema-first, no SQL
replay) instead.

The four, and the exact construct that makes them PostgreSQL-only:

| Migration | PostgreSQL construct |
|---|---|
| `20260827000000_add_apikey_scopes` | `ADD COLUMN "scopes" TEXT[] ... ARRAY[]::TEXT[]` — array type and cast |
| `20260829000000_add_payment_status_lifecycle_values` | `ALTER TYPE "PaymentStatus" ADD VALUE 'SIGNED' / 'SUBMITTED' / 'CONFIRMED'` |
| `20260829010000_add_schedule_run_key` | `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED'` |
| `20260829000000_add_refund_idempotency_and_audit_log` | `"details" JSONB` |

The other **12 apply cleanly on either provider**. They still are not replayed
on the SQLite path, because mixing "apply these" with "skip those" is how a
local schema silently diverges from the migrations. `db push` derives the schema
from `prisma/schema.prisma` and sidesteps the question.

`relationMode = "prisma"` is set in the schema (`prisma/schema.prisma`) because
SQLite has no foreign-key enforcement. It is kept for both providers so one data
model works on both; on PostgreSQL you get application-level referential
integrity instead of database-level. That is a real difference, not a
formality — a constraint violation that PostgreSQL would reject at the database
is rejected by Prisma (and may be missed by code paths that write through raw
SQL).

## Behavioural differences that bite

### `DATABASE_PROVIDER` selects nothing at the datasource level

`DATABASE_PROVIDER` is a **validated environment variable** (`src/lib/env.ts`,
Zod enum `"sqlite" | "postgresql"`, default `"postgresql"`) and it is read at
startup to log which provider is in use (`src/lib/startup.ts`). It is also
exposed through `getDatabaseProvider()`.

It does **not**, however, switch Prisma's datasource. The datasource block in
`prisma/schema.prisma` is hardcoded to `postgresql`; selecting SQLite means
editing that block by hand (a local, uncommitted change). Setting
`DATABASE_PROVIDER="sqlite"` with an unchanged schema points Prisma at a
PostgreSQL datasource while the application *reports* SQLite — a mismatch that
produces confusing failures. Change the datasource block, not just the variable.

> The header comment in `prisma/schema.prisma` says there is "no runtime
> env-var-based provider selection", which is true of the datasource and
> misleading about the app: the variable is validated and logged. This document
> is the accurate statement.

### `Decimal` precision

`@db.Decimal(18, 7)` appears on **8 fields**, and the annotation must be removed
for SQLite, which has no fixed-precision numeric type — Prisma stores `Decimal`
as its own arbitrary-precision text representation. The two are not the same:
PostgreSQL enforces 18 digits with 7 fractional places in the column type, while
the SQLite path enforces it (if at all) in application code.

> `prisma/schema.prisma` and `docs/LOCAL_DEV.md` both say **four** annotations.
> There are **eight**. Count with `grep -c "@db.Decimal" prisma/schema.prisma`
> before trusting either document, and treat a missed one as a runtime error
> rather than a style issue.

### Enums

PostgreSQL has native `ENUM` types; SQLite emulates them as `TEXT` with
client-side validation. Enum *values* are identical across providers, so
`db push` translates them — but a value written by raw SQL on SQLite is not
rejected the way it would be on PostgreSQL.

### Raw SQL

`prisma.$queryRaw` is used in `src/app/api/health/route.ts` (`SELECT 1`), which
is portable. Any future raw SQL is not automatically portable: PostgreSQL casts
(`::`), array types, `JSONB` operators and `CONCURRENTLY` have no SQLite
equivalent. Check new raw SQL against both providers before assuming it works.

### Concurrent index creation

`CREATE INDEX CONCURRENTLY` (see the production practices in
[`DATABASE_SCHEMA_MIGRATIONS.md`](./DATABASE_SCHEMA_MIGRATIONS.md)) is
PostgreSQL-only and cannot run inside a transaction. It is used in production
migrations, not in the local path.

## Commands

### PostgreSQL (deploy path — production and CI)

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/ophirpay"
export DIRECT_DATABASE_URL="postgresql://user:pass@host:5432/ophirpay"  # direct, unpooled

npx prisma migrate deploy   # apply committed migrations
npx prisma generate         # regenerate the client
npm run db:seed             # optional demo data
```

With a pooler (Neon, Supabase, PgBouncer), `DIRECT_DATABASE_URL` is mandatory
for migrations — PgBouncer does not support the session features they need.

### PostgreSQL (authoring a new migration)

```bash
npx prisma migrate dev --name describe_the_change
```

### SQLite (local UI work only)

```bash
# 1. Edit prisma/schema.prisma by hand: swap the datasource to sqlite and drop
#    all 8 @db.Decimal(18, 7) annotations. Do NOT commit these edits.
export DATABASE_URL="file:./dev.db"
export DATABASE_PROVIDER="sqlite"

# 2. Schema-first — migrations are not replayed
npx prisma db push
npx prisma generate
npm run db:seed
npm run dev
```

### Recommended path for a fresh local setup

Use PostgreSQL (Neon's free tier or a local server) unless you specifically want
to avoid running a database. Migration-authoring work, and anything touching
enums, `Decimal` or raw SQL, must be done against PostgreSQL — a change that
passes `db push` locally can still fail `migrate deploy` in CI, and CI is the
one that decides.

## Checklist before switching provider

- [ ] Datasource block in `prisma/schema.prisma` matches the provider (not just `DATABASE_PROVIDER`)
- [ ] All 8 `@db.Decimal(18, 7)` annotations removed for SQLite
- [ ] `DATABASE_URL` uses the right scheme (`file:` vs `postgresql://`)
- [ ] Schema applied with `db push` (SQLite) or `migrate deploy` (PostgreSQL)
- [ ] Client regenerated
- [ ] Schema edits reverted before committing — CI validates the committed PostgreSQL schema only
