# Prisma Database CI & Testing Guide

This document outlines the CI/CD pipeline, schema testing, and migration
verification workflows configured for Prisma in OphirPay.

---

## Architecture Overview

OphirPay uses Prisma ORM with **PostgreSQL** as the canonical database engine in
staging, CI, and production (`relationMode = "prisma"`).

```
┌────────────────────────────────────────────────────────┐
│               Developer Schema / Migration Change      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│            Pre-Commit & Local Validation               │
│  - npm run db:validate                                 │
│  - bash scripts/validate-prisma-migrations.sh          │
│  - npm run db:drift                                    │
│  - npm test src/__tests__/prisma-schema-ci.test.ts     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│           GitHub Actions Prisma CI Pipeline            │
│  - PostgreSQL 16 service container                     │
│  - npx prisma validate                                 │
│  - npx prisma generate                                 │
│  - bash scripts/validate-prisma-migrations.sh          │
│  - node scripts/verify-prisma-drift.mjs (static)       │
│  - npx prisma migrate diff --exit-code (shadow DB)     │
│  - npx prisma migrate deploy                           │
│  - Automated Vitest schema integrity suite             │
└────────────────────────────────────────────────────────┘
```

---

## Local Development & Pre-Commit Validation

Before committing schema or migration updates, run the validation toolchain:

```bash
# 1. Validate Prisma schema syntax and model definitions
npm run db:validate

# 2. Run structural and destructive migration scan
bash scripts/validate-prisma-migrations.sh

# 3. Static schema ⇄ migration drift check (no database required)
npm run db:drift

# 4. Execute unit & integration tests for Prisma schema integrity
npm test src/__tests__/prisma-schema-ci.test.ts
npm test src/__tests__/prisma-drift-checker.test.ts
```

`npm run db:drift` is the same check CI runs first. It replays every
`migration.sql` in order and compares the cumulative database state with
`schema.prisma`, printing each missing/stale model, field or enum value. It does
not need a database, so it is safe to run on every change.

---

## CI/CD Pipeline Workflow

The dedicated workflow `.github/workflows/prisma-ci.yml` runs automatically on
PRs and pushes touching `prisma/**` (and the drift scripts/docs):

1. **Syntax & Schema Validation**: Runs `npx prisma validate` against the schema.
2. **Client Generation**: Ensures `@prisma/client` builds without type errors.
3. **Migration Directory & Destructive SQL Scan**: `scripts/validate-prisma-migrations.sh`
   verifies every migration directory has a `migration.sql` and rejects
   `DROP DATABASE`.
4. **Static Drift Check**: `scripts/verify-prisma-drift.mjs` replays the
   committed migrations without a database and fails with the exact drifted
   fields/models.
5. **Shadow-DB Drift Check**: `prisma migrate diff --from-migrations …
--to-schema-datamodel … --exit-code` compares the migrations with the schema
   on a real PostgreSQL shadow database. `--exit-code` is what makes the step
   fail (exit 2) on drift; without it Prisma prints the diff and exits 0.
6. **Migration Deploy Replay**: Executes all migrations in `prisma/migrations/`
   sequentially against a fresh PostgreSQL 16 test instance.
7. **Schema Regression Tests**: Executes the Vitest suites checking relationship
   integrity, decimal precision on monetary columns, timestamp constraints and
   the drift checker itself.

### What a drift failure looks like

The static checker names the model/field:

```
❌ Found 2 drift issue(s):
   - Field 'Payment.settlementRef' is missing from migrations.
   - Enum 'PaymentStatus' is missing value 'DISPUTED' in migrations.

💡 Run `npx prisma migrate dev --name <migration>` to create a migration, or update schema.prisma.
```

The shadow-DB check additionally prints the SQL Prisma would need to apply (the
diff) and writes it to the job summary under "Prisma schema drift detected".

---

## Fixing drift

A schema edit without a migration is the failure this gate is designed to catch.
Fix it in the same PR:

```bash
# Generate the missing migration from the edited schema
npx prisma migrate dev --name describe_the_change

# Re-run the static gate, then the full local Prisma checks
npm run db:drift
npm run db:validate:migrations
```

Commit `prisma/schema.prisma` and the generated
`prisma/migrations/<timestamp>_<name>/migration.sql` together. Never edit an
already-applied migration: create a new one so every environment can replay the
same history.

---

## Best Practices for Database Changes

1. **Avoid Destructive Changes**: Never drop active production columns or tables without a two-step deprecation cycle.
2. **Monetary Precision**: Ensure all financial amount columns maintain `@db.Decimal(18, 7)` precision.
3. **Index Coverage**: Always index foreign keys and frequent query filters (`userId`, `status`, `createdAt`).
4. **Shadow Database**: Always run `prisma migrate dev` locally to test migration generation against a local shadow DB before opening a PR.
