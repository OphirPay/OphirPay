# Prisma Database CI & Testing Guide

This document outlines the CI/CD pipeline, schema testing, and migration verification workflows configured for Prisma in OphirPay.

---

## Architecture Overview

OphirPay uses Prisma ORM with **PostgreSQL** as the canonical database engine in staging, CI, and production (`relationMode = "prisma"`).

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
│  - npm test src/__tests__/prisma-schema-ci.test.ts     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│           GitHub Actions Prisma CI Pipeline            │
│  - PostgreSQL 15 Service Container                     │
│  - npx prisma validate                                 │
│  - npx prisma generate                                 │
│  - npx prisma migrate deploy                           │
│  - npx prisma migrate diff (Shadow DB Drift Detection) │
│  - Automated Vitest Schema Integrity Suite             │
└────────────────────────────────────────────────────────┘
```

---

## Local Development & Pre-Commit Validation

Before committing schema or migration updates, run the validation toolchain:

```bash
# 1. Validate Prisma schema syntax and model definitions
npm run db:validate

# 2. Run static Prisma schema ⇄ migration drift detection (no DB required)
node scripts/verify-prisma-drift.mjs

# 3. Run structural and destructive migration scan
bash scripts/validate-prisma-migrations.sh

# 4. Execute unit & integration tests for Prisma schema & migration drift integrity
npm test src/__tests__/prisma-schema-ci.test.ts src/__tests__/prisma-drift-check.test.ts
```

---

## CI/CD Pipeline Workflow

The dedicated workflow `.github/workflows/prisma-ci.yml` and the Vitest CI suite (`src/__tests__/prisma-drift-check.test.ts`) run automatically on PRs and pushes:

1. **Syntax & Schema Validation**: Runs `npx prisma validate` against the schema.
2. **Static Schema-to-Migration Drift Gate**: Runs `scripts/verify-prisma-drift.mjs` to replay all committed `prisma/migrations/*/migration.sql` files (including multi-column `ALTER TABLE ADD COLUMN` statements) and verify zero model, field, or enum drift against `prisma/schema.prisma`.
3. **Client Generation**: Ensures `@prisma/client` builds without type errors.
4. **Migration Deploy Replay**: Executes all migrations in `prisma/migrations/` sequentially against a fresh PostgreSQL test instance.
5. **Shadow DB Drift Detection**: Uses `prisma migrate diff` against a shadow database to verify that `schema.prisma` strictly matches the applied migrations.
6. **Schema Regression Tests**: Executes Vitest suite checking relationship integrity, decimal precision on monetary columns, and timestamp constraints.

---

## Best Practices for Database Changes

1. **Avoid Destructive Changes**: Never drop active production columns or tables without a two-step deprecation cycle.
2. **Monetary Precision**: Ensure all financial amount columns maintain `@db.Decimal(18, 7)` precision.
3. **Index Coverage**: Always index foreign keys and frequent query filters (`userId`, `status`, `createdAt`).
4. **Shadow Database**: Always run `prisma migrate dev` locally to test migration generation against a local shadow DB before opening a PR.

