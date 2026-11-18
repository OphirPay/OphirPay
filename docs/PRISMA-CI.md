# Prisma Database CI, Migration & Rollback Guide

This document outlines the database migration workflows, disaster recovery and
rollback procedures, CI/CD pipeline verification gates, and zero-downtime schema
evolution guidelines configured for Prisma in OphirPay.

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

## Migration Workflows: Development vs Production

Prisma provides two primary commands for applying migrations: `prisma migrate dev` and `prisma migrate deploy`. Understanding the strict boundaries between these two commands is essential for avoiding catastrophic data loss in production.

| Feature | `npx prisma migrate dev` | `npx prisma migrate deploy` |
|---|---|---|
| **Intended Environment** | **Local development only** | **CI/CD, Staging, Production** |
| **Shadow Database** | Requires and uses shadow database to detect drift | Does **not** use a shadow database |
| **Generates Migration Files** | Yes, creates timestamped SQL files in `prisma/migrations/` | No, only reads committed migration SQL files |
| **Interactive Prompts** | Yes, prompts for migration name or schema reset | Strictly non-interactive (fails if human input needed) |
| **Destructive Resets** | Can trigger `prisma migrate reset` (drops DB) if drifted | **Never resets or drops the database** |
| **Client Generation** | Automatically runs `prisma generate` | Does not run `prisma generate` (must run separately) |
| **Transaction Safety** | Executes migration inside transactions where supported | Executes each unapplied migration file in a transaction |

### 1. Local Development: `npx prisma migrate dev`

Use `prisma migrate dev` exclusively while developing locally on your development machine or container:

```bash
# 1. Edit prisma/schema.prisma with your model/field changes
# 2. Run migrate dev to generate and apply the new migration
npx prisma migrate dev --name add_payment_metadata
```

What `prisma migrate dev` does:
1. Replays the existing migration history on a temporary shadow database.
2. Compares the state of the shadow database against `prisma/schema.prisma`.
3. Creates a new migration folder under `prisma/migrations/<timestamp>_<name>/migration.sql`.
4. Executes the new migration script against your local database (`DATABASE_URL`).
5. Updates the `_prisma_migrations` tracking table in your database.
6. Regenerates `@prisma/client` types automatically.

> [!CAUTION]
> **Never run `npx prisma migrate dev` in Staging or Production.**
> If `migrate dev` detects that the database schema has diverged from migration history (e.g., if hotfixes or manual DDL were applied), it will prompt to reset the database:
> ```text
> ⚠️ We found changes that cannot be applied:
> The database will be reset.
> Do you want to continue? All data will be lost. [y/N]
> ```
> In automated environments, this can lead to unrecoverable data loss.

### 2. Staging & Production: `npx prisma migrate deploy`

In staging, production, and CI/CD pipelines, migrations are executed deterministically using `npx prisma migrate deploy`:

```bash
# Apply all pending migrations safely and non-interactively
npx prisma migrate deploy
```

What `prisma migrate deploy` does:
1. Queries the `_prisma_migrations` table in the target database to determine which migrations have already been applied.
2. Compares the recorded checksums of applied migrations against the local `migration.sql` files in the deployed bundle.
3. If any applied migration file has been edited or tampered with, it aborts immediately with a checksum mismatch error.
4. Applies any unapplied migrations sequentially in chronological order.
5. Records the start time, completion time, and execution status of each applied migration in `_prisma_migrations`.
6. Exits with code `0` on success, or a non-zero exit code on failure without rolling back previous migrations that succeeded.

---

## Greenfield Setup & Baseline Migration Procedures

### 1. Fresh Database Setup (Greenfield)

When spinning up a new staging, production, or testing environment with an empty database:

```bash
# 1. Ensure DATABASE_URL is set in the environment
export DATABASE_URL="postgresql://user:password@host:5432/ophirpay"

# 2. Replay all committed migrations in order
npx prisma migrate deploy

# 3. Populate default fixtures and seed data
npm run db:seed
```

Available seed profiles:
- `npm run db:seed`: Standard development seed.
- `npm run db:seed:staging`: Staging dataset with synthetic merchant accounts.
- `npm run db:seed:minimal`: Minimal baseline seed (system configurations only).
- `npm run db:seed:load`: High-volume dataset for concurrency and stress testing.

### 2. Baselining Pre-Existing Databases

If you are onboarding an existing production database that already contains tables created by an external tool or previous migration framework:

1. Create a baseline migration containing the initial schema state:
   ```bash
   mkdir -p prisma/migrations/0_init
   npx prisma migrate diff \
     --from-empty \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/0_init/migration.sql
   ```
2. Mark the baseline migration as already applied on the pre-existing database without executing the SQL (which would fail with `relation already exists`):
   ```bash
   npx prisma migrate resolve --applied 0_init
   ```
3. Subsequent runs of `npx prisma migrate deploy` will recognize `0_init` as completed and only execute newer migrations.

---

## Migration Rollback & Disaster Recovery Workflows

Prisma ORM does not support automatic down-migrations (e.g., `down.sql`). Because schema transformations often entail data conversions (such as dropping a column or modifying a data type), reverse migrations cannot be automatically inferred without risking silent data truncation.

OphirPay uses a **forward-only migration strategy** for rollbacks, supplemented by database point-in-time recovery.

### 1. The Forward-Only Rollback Pattern (Recommended)

When a deployed migration causes regressions or needs to be undone in staging or production, roll back by generating a new forward migration that reverses the changes:

```bash
# 1. Update schema.prisma to revert the undesirable schema changes
# 2. Generate a compensating rollback migration locally
npx prisma migrate dev --name revert_payment_metadata

# 3. Inspect and verify the generated SQL in prisma/migrations/*_revert_payment_metadata/migration.sql
# 4. Commit the compensating migration and schema.prisma to Git
git add prisma/
git commit -m "fix(database): revert payment metadata column additions"

# 5. Deploy the forward rollback migration through standard CI/CD
npx prisma migrate deploy
```

### 2. Resolving Failed Migrations in Production

If a migration fails midway during `npx prisma migrate deploy` (e.g., due to a syntax error, lock timeout, constraint violation, or out-of-disk condition), Prisma marks that migration as failed in `_prisma_migrations` and refuses to run any further migrations.

To diagnose and resolve a failed migration:

#### Step 1: Diagnose the Failure
Run `prisma migrate status` to identify the failing migration:
```bash
npx prisma migrate status
```
Output will indicate:
```text
The `20261015120000_add_payment_metadata` migration started at ... failed.
```
You can also inspect the internal table:
```sql
SELECT id, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
FROM "_prisma_migrations"
ORDER BY started_at DESC LIMIT 5;
```

#### Step 2: Choose the Resolution Path

**Path A: Roll Back Failed State and Re-apply (Most Common)**
1. Connect to PostgreSQL via `psql` and manually revert any partial DDL changes applied by the failed migration script.
2. Tell Prisma that the failed migration was rolled back:
   ```bash
   npx prisma migrate resolve --rolled-back "20261015120000_add_payment_metadata"
   ```
3. Fix the underlying issue in `migration.sql` or resolve the data conflict in PostgreSQL.
4. Re-run deployment:
   ```bash
   npx prisma migrate deploy
   ```

**Path B: Manually Complete the Migration (Hotfix)**
1. Connect to PostgreSQL via `psql` and manually complete the remaining SQL statements that failed.
2. Tell Prisma that the migration has been successfully applied:
   ```bash
   npx prisma migrate resolve --applied "20261015120000_add_payment_metadata"
   ```
3. Verify status:
   ```bash
   npx prisma migrate status
   # Database schema is up to date!
   ```

### 3. Disaster Recovery & Point-in-Time Recovery (PITR)

Before executing high-risk migrations on production (such as large table alterations or backfills):

```bash
# Export compressed snapshot of the production schema and data
pg_dump -Fc --no-acl --no-owner -d "$DATABASE_URL" -f "ophirpay_pre_migration_$(date +%Y%m%d_%H%M%S).dump"

# In the event of catastrophic data corruption, restore the snapshot to a clean database:
pg_restore --clean --if-exists --no-acl --no-owner -d "$DATABASE_URL" "ophirpay_pre_migration_*.dump"
```

In managed cloud environments (AWS RDS Aurora, Neon, Supabase), verify that **Continuous Archiving (WAL) and Point-in-Time Recovery (PITR)** are enabled with a retention period of at least 7 days before running major version migrations.

---

## Breaking Schema Changes & Zero-Downtime Guidelines

To prevent downtime for active clients and in-flight API transactions during continuous deployment, all schema modifications must follow the **Expand and Contract** pattern.

### 1. Adding a `NOT NULL` Column to an Existing Table

Never add a `NOT NULL` column without a default value to a table containing existing data in a single migration. Doing so locks the table and fails with `column contains null values`.

**Correct 3-Step Procedure:**
1. **Phase 1 (Expand):** Add the column as nullable or provide a database-level `DEFAULT`:
   ```sql
   ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
   ```
2. **Phase 2 (Backfill & Dual-Read):** Deploy application code that writes to `idempotencyKey` on new records, and execute a background job to backfill legacy rows.
3. **Phase 3 (Contract):** Once all rows are populated, add the `NOT NULL` constraint via a separate migration:
   ```sql
   ALTER TABLE "Payment" ALTER COLUMN "idempotencyKey" SET NOT NULL;
   ```

### 2. Renaming a Column or Table

Directly renaming a column (`ALTER TABLE "Payment" RENAME COLUMN "amt" TO "amount"`) breaks any running application pods that are executing queries during a rolling update.

**Correct 4-Step Procedure:**
1. **Expand:** Add the new column `amount`.
2. **Dual-Write:** Deploy application code that reads from `amt` and writes to both `amt` and `amount`.
3. **Backfill & Switch Read:** Backfill `amount` from `amt` across historical records; deploy code reading from `amount`.
4. **Contract:** Remove references to `amt` from code, then drop the legacy column in a follow-up migration.

### 3. Dropping Columns or Tables

1. Deploy application code that stops reading and writing the column/table.
2. Verify application metrics and logs to ensure no active queries touch the element.
3. Apply the migration dropping the column/table.

### 4. Monetary Precision

Financial systems require exact decimal representation. All monetary columns must use `@db.Decimal(18, 7)` in `schema.prisma`. Floating-point types (`Float` / `Double`) are prohibited.

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

## Summary Checklist for Database Changes

- [ ] Schema changes are drafted in `prisma/schema.prisma`.
- [ ] Migration generated via `npx prisma migrate dev --name <name>` on a local machine.
- [ ] Monetary columns maintain `@db.Decimal(18, 7)` precision.
- [ ] Foreign keys and high-cardinality filters (`userId`, `status`, `createdAt`) are indexed.
- [ ] Destructive actions (`DROP COLUMN`, `DROP TABLE`) adhere to expand-and-contract deprecation.
- [ ] `npm run db:validate` and `npm run db:drift` pass cleanly.
- [ ] Both `prisma/schema.prisma` and `prisma/migrations/**` are committed together in the PR.
