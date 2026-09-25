# 🗄️ Database Schema & Migration Guide

> Comprehensive architectural guide to the OphirPay PostgreSQL schema, entity relationships, safe migration authoring workflows, and zero-downtime production deployment patterns.

---

## 1. Schema Architecture & Key Entities

OphirPay uses **Prisma ORM** with **PostgreSQL** in production and **SQLite** for local development. The database models are defined in `prisma/schema.prisma`.

```mermaid
erDiagram
    User ||--o{ Account : owns
    User ||--o{ Payment : creates
    User ||--o{ Batch : owns
    User ||--o{ Recurrence : owns
    User ||--o{ PaymentRequest : creates
    User ||--o{ Webhook : configures
    User ||--o{ ApiKey : creates
    User ||--o{ Refund : requests
    User ||--o{ NotificationHook : registers

    Account ||--o{ Payment : "source of"
    Account ||--o{ Payment : "destinations for"
    Batch ||--o{ Payment : contains
    Recurrence ||--o{ Payment : generates
    Payment ||--o{ Refund : "may have"
```

### Core Table Reference

| Table | Primary Key | Description | Key Foreign Keys |
| :--- | :--- | :--- | :--- |
| **`User`** | `id` (CUID) | Root identity holding Stellar public keys, email, and user profile data. | None |
| **`Account`** | `id` (CUID) | Linked Stellar accounts and labels owned by a User. | `userId → User(id)` |
| **`Payment`** | `id` (CUID) | Core transaction ledger recording amount, asset code (`XLM`/token), memo, status, and on-chain tx hash. | `userId → User(id)`<br>`sourceAccountId → Account(id)`<br>`destAccountId → Account(id)`<br>`batchId → Batch(id)`<br>`recurrenceId → Recurrence(id)` |
| **`Batch`** | `id` (CUID) | Groups multiple payments for batch processing and aggregated status tracking. | `userId → User(id)` |
| **`Recurrence`** | `id` (CUID) | Cron/scheduler configuration for recurring payment automations (`DAILY`, `WEEKLY`, `MONTHLY`). | `userId → User(id)` |
| **`PaymentRequest`** | `id` (CUID) | Invoices and payment links with lifecycle status (`PENDING`, `PAID`, `EXPIRED`, `CANCELLED`). | `userId → User(id)` |
| **`Refund`** | `id` (CUID) | On-chain Soroban refund ledger mapping DB states to `onChainId`. | `userId → User(id)`<br>`paymentId → Payment(id)` |
| **`Webhook`** | `id` (CUID) | Registered endpoints receiving HMAC-signed event notifications. | `userId → User(id)` |
| **`ApiKey`** | `id` (CUID) | Programmatic authentication storing SHA-256 `keyHash` and 8-character display `prefix`. | `userId → User(id)` |
| **`NotificationHook`** | `id` (CUID) | Mirrors on-chain Soroban event hooks to route contract signals. | `userId → User(id)` |

---

## 2. Migration Authoring Workflow

Follow these steps whenever modifying models, adding tables, or altering column constraints:

### Step 1: Update `prisma/schema.prisma`
Edit `prisma/schema.prisma` to declare your new field or table. Ensure you add necessary `@@index` annotations for columns used in query `WHERE`, `JOIN`, or `ORDER BY` clauses.

### Step 2: Generate Migration SQL (Without Applying)
Generate a clean SQL migration file using Prisma:

```bash
# Generate the migration file without immediately executing on production
npx prisma migrate dev --name <descriptive_migration_name> --create-only
```

This creates a new timestamped directory under `prisma/migrations/<timestamp>_<descriptive_migration_name>/migration.sql`.

### Step 3: Review and Refine the Migration SQL
Inspect the generated `migration.sql` file. Check for:
* Correct column types (e.g., `DECIMAL(18, 7)` for asset balances).
* Proper foreign key constraints and default values.
* Safe index creation patterns (see Section 3 below).

### Step 4: Apply and Test Locally
Apply the migration to your local database:

```bash
# Apply pending migrations locally
npx prisma migrate dev

# Regenerate Prisma Client types
npx prisma generate

# Seed sample development data
npx tsx prisma/seed.ts
```

---

## 3. Safe PostgreSQL Production Practices

### ⚠️ The `CREATE INDEX CONCURRENTLY` Caveat

In production PostgreSQL databases, creating an index with standard `CREATE INDEX` acquires an `EXCLUSIVE LOCK` on the table, blocking all concurrent `INSERT`, `UPDATE`, and `DELETE` queries until the index finishes building.

To prevent downtime on high-traffic tables (such as `Payment`), use **`CREATE INDEX CONCURRENTLY`**.

#### Critical Transaction Rule:
> **`CREATE INDEX CONCURRENTLY` CANNOT run inside a transaction block (`BEGIN ... COMMIT`).**  
> Prisma wraps migration files in a transaction block by default.

#### How to Author a Concurrent Index Migration Safely:

1. In the generated `migration.sql`, remove standard `CREATE INDEX` statements if targeting large production tables.
2. If using Prisma, mark the migration or execute non-transactional DDL scripts using custom migration runners or Prisma's `--skip-seed` flags.
3. Example valid syntax:
   ```sql
   -- Execute outside of BEGIN/COMMIT blocks
   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_userId_status_idx" 
   ON "Payment"("userId", "status");
   ```

---

### Zero-Downtime Schema Evolution Rules

| Operation | Unsafe Approach (Causes Outage) | Safe Zero-Downtime Approach |
| :--- | :--- | :--- |
| **Adding a `NOT NULL` Column** | `ALTER TABLE "Payment" ADD COLUMN "fee" DECIMAL NOT NULL;` | 1. Add as nullable: `ADD COLUMN "fee" DECIMAL;`<br>2. Backfill existing rows with defaults.<br>3. Set `NOT NULL` in a subsequent migration. |
| **Renaming a Column** | `ALTER TABLE "User" RENAME COLUMN "stellarAddress" TO "publicKey";` | 1. Add new column `publicKey`.<br>2. Dual-write in application layer.<br>3. Backfill data.<br>4. Deprecate and drop old column. |
| **Dropping a Column** | `ALTER TABLE "Payment" DROP COLUMN "oldField";` | Remove references in application code first, deploy code, then drop the column. |

---

## 4. Local Testing & Drift Verification

### Check for Schema Drift
Run the schema drift check to verify that your `schema.prisma` matches the migration history:

```bash
# Compare Prisma schema against migration files
npx prisma migrate diff   --from-schema-datamodel prisma/schema.prisma   --to-migrations prisma/migrations   --shadow-database-url "$SHADOW_DATABASE_URL"
```

### Resetting Local Test Database
To reset and re-run all migrations from scratch in local development:

```bash
npx prisma migrate reset --force
```

---

## 5. PostgreSQL vs. SQLite Provider Comparison & Limitations

OphirPay supports two database engines via Prisma ORM: **PostgreSQL** (the canonical, production engine) and **SQLite** (a local zero-dependency development fallback). However, they are **not interchangeable drop-in replacements**.

### 5.1 Supported Provider Matrix

| Environment | Supported Provider | Enforcement Mechanism | Rationale |
| :--- | :--- | :--- | :--- |
| **Production / Staging** | **PostgreSQL only** | `prisma/schema.prisma` (`datasource.provider = "postgresql"`), `prisma/migrations/migration_lock.toml`, and runtime Zod validation in `src/lib/env.ts`. | High concurrency, MVCC row-level locking, atomic transactions across parallel webhooks and jobs, native Decimal precision. |
| **CI (GitHub Actions)** | **PostgreSQL only** | GitHub Actions workflow spins up a PostgreSQL container service; runs `npx prisma migrate deploy`. | Validates real database migrations against the committed PostgreSQL migration history. |
| **Local Dev (Recommended)** | **PostgreSQL** | Docker container (`postgres:16-alpine`) or hosted serverless Postgres (Neon / Supabase). | Full parity with production: runs committed migrations, enforces native enums and Decimal precision. |
| **Local Dev (Fallback)** | **SQLite** | Requires local uncommitted schema edits (swap provider to `sqlite`, drop `@db.Decimal` annotations) + `npx prisma db push`. | Lightweight offline development without running Docker or cloud databases. |

> [!CAUTION]
> **Never run SQLite in staging or production environments.**
> SQLite's file-level locking (`SQLITE_BUSY`) cannot handle concurrent webhook dispatches, background payment reconciliation jobs, or multi-instance/multi-pod deployments. Additionally, Prisma migrations are locked to PostgreSQL and cannot deploy to SQLite.

---

### 5.2 Behavioral & Architectural Differences

When developing against SQLite versus PostgreSQL, multiple database-level and application-level behaviors diverge:

#### 1. Concurrency & Locking
* **PostgreSQL:** Uses Multi-Version Concurrency Control (MVCC) with row-level locks (`SELECT FOR UPDATE`, row-level writes). Multiple HTTP requests, background cron jobs (e.g. `reconcile-payments`, `process-recurrences`), and webhook worker threads execute concurrently without blocking the entire database.
* **SQLite:** Employs database-level / file-level locking. Even with WAL (Write-Ahead Logging) mode enabled, SQLite allows only a single active writer at any instant. Concurrent write attempts from asynchronous API routes, webhook deliveries, or scheduled jobs will collide and throw `SQLITE_BUSY: database is locked` (Prisma error code `P2028` or `P2034`).

#### 2. Transactions & Interactive Transaction Isolation
* **PostgreSQL:** Supports standard SQL isolation levels (`READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`). Prisma interactive transactions (`prisma.$transaction(async (tx) => ...)`) isolate row changes while allowing concurrent operations on unaffected rows.
* **SQLite:** Interactive transactions lock the entire database file for the duration of the transaction block. Slow network operations or long-running computations inside a Prisma `$transaction` on SQLite freeze all other write operations across the application.

#### 3. Decimal Precision & Prisma Types
* **PostgreSQL:** Native arbitrary fixed-point precision via `DECIMAL(18, 7)` enforced at the database engine level across five financial fields:
  1. `Payment.amount`
  2. `Recurrence.amount`
  3. `ScheduledPayment.amount`
  4. `PaymentRequest.amount`
  5. `Refund.amount`
* **SQLite:** Has no native fixed-point Decimal type. SQLite rejects `@db.Decimal(18, 7)` attribute annotations during schema parsing or push (`Native type Decimal is not supported for sqlite connector`). In SQLite, these annotations must be stripped, and Prisma stores `Decimal` values as text representations, relying entirely on client-side JS parsing (`Decimal.js`). Math performed directly in the database engine or raw SQL loses fixed-point guarantees.

#### 4. Enums
* **PostgreSQL:** Uses native engine ENUM types created via `CREATE TYPE "..." AS ENUM (...)` (`PaymentStatus`, `BatchStatus`, `Frequency`, `RequestStatus`, `RefundStatus`). Values are strictly validated at the database engine level; inserting an illegal enum value via direct SQL or external clients fails with an engine error.
* **SQLite:** Has no native ENUM types. Prisma translates enums into `TEXT` columns in SQLite with client-side JavaScript validation. Direct SQL inserts or third-party SQLite tools can insert arbitrary invalid strings without database rejection.

#### 5. Referential Integrity & Foreign Keys (`relationMode`)
* **PostgreSQL:** Foreign key constraints are enforced directly by the PostgreSQL relational engine with cascading actions (`ON DELETE CASCADE`, `ON UPDATE CASCADE`).
* **SQLite:** The schema specifies `relationMode = "prisma"`, meaning referential integrity and relation constraints are emulated in the Prisma Client layer rather than enforced by SQLite database engine foreign keys.

#### 6. Case Sensitivity, Pattern Matching, and Raw SQL
* **PostgreSQL:** Differentiates between case-sensitive `LIKE` and case-insensitive `ILIKE`. Supports full-text search (`tsvector`, `tsquery`, `GIN` indexes) and POSIX regex matches (`~*`).
* **SQLite:** `LIKE` is case-insensitive for standard ASCII characters by default. SQLite does not support `ILIKE`, native regex operators, or PostgreSQL `GIN` / `tsvector` indexes.
* **Raw SQL Queries:** Raw queries using `$queryRaw` or `$executeRaw` that use PostgreSQL-specific functions (e.g., `NOW()`, `GEN_RANDOM_UUID()`, JSON traversal `->>`, `RETURNING` clauses, or `CREATE INDEX CONCURRENTLY`) fail on SQLite. In OphirPay, the `/api/health` check uses cross-compatible `SELECT 1`.

---

### 5.3 Migration Workflow & Why Committed Migrations Do NOT Apply to SQLite

A critical source of confusion for new contributors is the committed migration history in `prisma/migrations/`.

#### Why 0 of the Committed Migrations Apply to SQLite:
1. **Migration Provider Lock:** `prisma/migrations/migration_lock.toml` explicitly sets `provider = "postgresql"`. Prisma Migrate rejects execution against an SQLite datasource:
   ```text
   Error: The datasource provider 'sqlite' specified in your schema does not match the provider 'postgresql' in the migration_lock.toml.
   ```
2. **PostgreSQL-Specific DDL:** Every committed migration file (`20260810210941_initial_migration` through latest) contains PostgreSQL-specific SQL syntax that causes immediate SQLite parser failures:
   * `CREATE TYPE "PaymentStatus" AS ENUM (...)` (SQLite has no `CREATE TYPE`)
   * `TIMESTAMP(3)` column definitions (SQLite only supports `DATETIME` or `TEXT`)
   * `DECIMAL(18, 7)` column definitions
   * `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...` (SQLite does not support adding foreign keys via `ALTER TABLE`)

**Conclusion:** **Zero (0) of the migrations apply cleanly on SQLite.** SQLite cannot use `prisma migrate dev` or `prisma migrate deploy`.

#### Command Matrix by Provider

| Task | PostgreSQL (Production, CI, Local Parity) | SQLite (Local Dev Fallback Only) |
| :--- | :--- | :--- |
| **Apply pending migrations** | `npx prisma migrate deploy` | ❌ *Unsupported* (fails on Postgres DDL) |
| **Create a new migration** | `npx prisma migrate dev --name <name>` | ❌ *Unsupported* |
| **Sync schema changes** | `npx prisma db push` | `npx prisma db push` *(the only valid way)* |
| **Reset database** | `npx prisma migrate reset` | Delete `dev.db` and run `npx prisma db push` |
| **Inspect database** | `npx prisma studio` | `npx prisma studio` |
| **Generate client types** | `npx prisma generate` | `npx prisma generate` |
| **Seed sample data** | `npm run db:seed` (`npx tsx prisma/seed.ts`) | `npm run db:seed` (`npx tsx prisma/seed.ts`) |

---

### 5.4 Moving Data Between PostgreSQL and SQLite

Direct database dumps (`pg_dump` or SQLite `.dump`) are **incompatible** due to dialect and type divergence:
* `pg_dump` outputs PostgreSQL-specific schema definitions, `COPY` blocks with Postgres type formatting, and enum casts that SQLite cannot parse.
* SQLite `.dump` outputs SQLite table structures and unquoted identifiers that PostgreSQL rejects or violates PostgreSQL foreign key / enum constraints.

#### Recommended Data Transfer Methods:
1. **Application-Level Seeding:** For local development and testing, run the canonical seed script:
   ```bash
   npm run db:seed
   ```
   `prisma/seed.ts` operates via Prisma Client, abstracting dialect differences and working identically on both PostgreSQL and SQLite.
2. **JSON Export / Import:** To transfer data from an existing PostgreSQL database to a local SQLite database (or vice-versa), export table records as JSON using Prisma Client or Node scripts, then upsert them in the target database using Prisma Client.
3. **Prisma Studio:** Launch `npx prisma studio` against the source database to view and export records, then inspect or import in the target environment.

---

### 5.5 Recommended Fresh Local Setup Paths

#### Path A: PostgreSQL via Docker (Recommended for Full Parity)
Provides 100% production parity without altering any files in git.

```bash
# 1. Start a local PostgreSQL 16 container
docker run --name ophirpay-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ophirpay \
  -p 5432:5432 -d postgres:16-alpine

# 2. Configure .env.local
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ophirpay"
DATABASE_PROVIDER="postgresql"

# 3. Apply migrations and seed
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

#### Path B: Hosted PostgreSQL (Neon / Supabase)
Requires zero local Docker daemon. Follow [docs/LOCAL_DEV.md §3](./LOCAL_DEV.md#3-option-b--neon-hosted-postgresql-production-parity).

#### Path C: SQLite (Zero External Services)
Ideal for fast UI work or unit tests when Docker is unavailable:

```bash
# 1. Temporarily modify prisma/schema.prisma (UNCOMMITTED):
#    - Swap datasource provider from "postgresql" to "sqlite"
#    - Drop the 5 `@db.Decimal(18, 7)` annotations on:
#      Payment.amount, Recurrence.amount, ScheduledPayment.amount,
#      PaymentRequest.amount, Refund.amount

# 2. Configure .env.local
DATABASE_URL="file:./dev.db"
DATABASE_PROVIDER="sqlite"

# 3. Push schema directly and seed (DO NOT run prisma migrate)
npx prisma db push
npx prisma generate
npm run db:seed
```

---

## 6. Summary Checklist for Pull Requests

Before submitting a PR with database changes:
- [ ] `prisma/schema.prisma` contains clear doc comments (`///`) on all new models/fields.
- [ ] Migration generated under `prisma/migrations/` with a descriptive name.
- [ ] No blocking locks on production tables (indexes reviewed for `CONCURRENTLY` requirements).
- [ ] Verified that changes adhere to PostgreSQL schema standards and `@db.Decimal(18, 7)` annotations are documented.
- [ ] `npx prisma generate` builds clean TypeScript types without errors.
- [ ] Seeding script (`prisma/seed.ts`) runs successfully.

