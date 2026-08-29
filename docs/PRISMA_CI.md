# Prisma CI & Schema Validation

This document describes the automated checks that run on every change to `prisma/schema.prisma` or files under `prisma/migrations/`.

## Checks

### 1. Schema Validation (`npx prisma validate`)

Ensures the schema file is syntactically valid and all models/relations are well-formed.

### 2. Client Generation (`npx prisma generate`)

Confirms the Prisma client can be generated from the current schema. This catches type errors in custom query extensions or generator configuration.

### 3. Migration Deployment (`npx prisma migrate deploy`)

Applies all migrations to a fresh PostgreSQL database. This detects:
- Broken or incompatible migrations
- Missing migration files
- SQL errors in existing migrations

### 4. Schema Drift Detection (`npx prisma migrate diff`)

Compares the state produced by `prisma/migrations` against `prisma/schema.prisma` using a shadow database. If the schema has changed without a corresponding migration, the check fails.

## Workflows

| Workflow | Trigger | File |
|----------|---------|------|
| `prisma.yml` | Push/PR touching `prisma/**` | `.github/workflows/prisma.yml` |
| `ci.yml` | All push/PR | `.github/workflows/ci.yml` (also contains `prisma-validate` job) |

## Pre-commit Hook

A Husky pre-commit hook runs `npx prisma validate` whenever a Prisma-related file is staged.

```bash
# Install hooks
npx husky install
```

## Local Testing

```bash
# Validate schema
npx prisma validate

# Generate client
npx prisma generate

# Check drift (requires PostgreSQL shadow DB)
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL"
```

## Fixing Common Failures

| Failure | Fix |
|---------|-----|
| `Validation error` | Run `npx prisma validate` locally and fix schema errors. |
| `Migration drift detected` | Run `npx prisma migrate dev --name <descriptive-name>` and commit the new migration. |
| `Migration deploy failed` | Inspect the migration SQL and ensure it is compatible with PostgreSQL 16. |
