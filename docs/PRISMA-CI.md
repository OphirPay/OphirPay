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

# 2. Run structural and destructive migration scan
bash scripts/validate-prisma-migrations.sh

# 3. Execute unit & integration tests for Prisma schema integrity
npm test src/__tests__/prisma-schema-ci.test.ts
```

---

## CI/CD Pipeline Workflow

The dedicated workflow `.github/workflows/prisma-ci.yml` runs automatically on PRs and pushes touching `prisma/**`:

1. **Syntax & Schema Validation**: Runs `npx prisma validate` against the schema.
2. **Client Generation**: Ensures `@prisma/client` builds without type errors.
3. **Migration Deploy Replay**: Executes all migrations in `prisma/migrations/` sequentially against a fresh PostgreSQL test instance.
4. **Drift Detection**: Uses `prisma migrate diff` against a shadow database to verify that `schema.prisma` strictly matches the applied migrations.
5. **Schema Regression Tests**: Executes Vitest suite checking relationship integrity, decimal precision on monetary columns, and timestamp constraints.

---

## Best Practices for Database Changes

1. **Avoid Destructive Changes**: Never drop active production columns or tables without a two-step deprecation cycle.
2. **Monetary Precision**: Ensure all financial amount columns maintain `@db.Decimal(18, 7)` precision.
3. **Index Coverage**: Always index foreign keys and frequent query filters (`userId`, `status`, `createdAt`).
4. **Shadow Database**: Always run `prisma migrate dev` locally to test migration generation against a local shadow DB before opening a PR.
