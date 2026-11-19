# 🛠 Local Development Guide

> **Goal:** get a fully working OphirPay instance running on your machine — with
> either **SQLite** (zero-setup, file-based) or **Neon** (hosted PostgreSQL,
> closest to production) — including seed data and Testnet funding.

---

## 0. Devcontainer (Fastest Path)

If you use **GitHub Codespaces** or **VS Code Devcontainers**, you can skip all local toolchain setup. The repository includes a `.devcontainer` configuration that automatically provisions:

- Node 24
- Rust 1.91.0 with the Soroban `wasm32` targets
- PostgreSQL and Redis (via `docker-compose`)

**Steps:**

1. Open the project in a Devcontainer.
2. `cp .env.example .env.local`
3. `npx prisma db push && npx prisma generate`
4. `npm run dev`

If you prefer to develop natively on your host machine without containers, continue with the prerequisites below.

---

## 1. Prerequisites

| Tool                                      | Version                                      | Purpose                                                   |
| ----------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| [Node.js](https://nodejs.org)             | 24 (see `.nvmrc`)                            | Runtime — use `nvm use` if you have nvm                   |
| [npm](https://www.npmjs.com)              | 9+ (ships with Node)                         | Package manager                                           |
| [Git](https://git-scm.com)                | Any                                          | Clone the repo                                            |
| [Rust](https://rustup.rs)                 | 1.91.0 (see `contracts/rust-toolchain.toml`) | Compiles Soroban smart contracts to WASM                  |
| [Freighter Wallet](https://freighter.app) | Latest                                       | Browser extension for signing Stellar transactions        |
| A Stellar account                         | —                                            | Create one in Freighter, then fund it on Testnet (see §4) |

```bash
# 1. Clone and enter
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay

# 2. Install dependencies (matches CI: uses package-lock.json)
npm ci

# 3. Copy the environment template
cp .env.example .env.local
```

### 1.1 Soroban Smart Contract Toolchain Setup

Building Soroban smart contracts requires matching toolchain versions (Rust `1.91.0`, `wasm32-unknown-unknown`, `wasm32v1-none`, and `stellar-cli` / `soroban-cli`). Without a deterministic setup, local compilation can result in mismatched WASM hashes compared to CI artifacts.

Run the automated setup script to install the exact toolchain and targets pinned in `contracts/rust-toolchain.toml`:

```bash
# Install the pinned toolchain, components (rustfmt, clippy), and targets
./scripts/setup-soroban-env.sh

# Optionally also install stellar-cli via cargo:
./scripts/setup-soroban-env.sh --install-cli
```

### 1.2 WASM Reproducibility Verification

To verify that locally compiled contract WASM artifacts match CI golden artifacts byte-for-byte:

```bash
./scripts/verify-wasm-reproducibility.sh
```

This builds `contracts/ophirpay` and `contracts/emitter` with deterministic compiler flags (`--locked`, `-C opt-level=z`, `-C link-arg=-s`, and `--remap-path-prefix`) and verifies the SHA-256 hashes against `contracts/expected-wasm-hashes.sha256`.

If the contract sources were intentionally changed, update the committed expected hashes:

```bash
./scripts/verify-wasm-reproducibility.sh --update
```

### 1.3 Local Stellar Quickstart Standalone Container (Offline Testing & Development)

For offline contract development, rapid test iterations, or testing without reliance on the public Stellar Testnet friendbot rate limits, you can run a local **Stellar Quickstart Docker container** in `--standalone` mode with Soroban RPC enabled.

#### Starting the Standalone Container

Run the official Stellar Quickstart container mapping RPC and Horizon port `8000`:

```bash
docker run --rm -it \
  -p 8000:8000 \
  --name stellar-standalone \
  stellar/quickstart:testing \
  --standalone \
  --enable-soroban-rpc
```

For background (detached) execution, replace `-it` with `-d`:

```bash
docker run -d \
  -p 8000:8000 \
  --name stellar-standalone \
  stellar/quickstart:testing \
  --standalone \
  --enable-soroban-rpc
```

#### Endpoints & Network Parameters

When running, the standalone container exposes:

| Component       | Endpoint                             | Description                                    |
| --------------- | ------------------------------------ | ---------------------------------------------- |
| **Soroban RPC** | `http://localhost:8000/soroban/rpc`  | JSON-RPC 2.0 endpoint for smart contracts      |
| **Horizon API** | `http://localhost:8000`              | Horizon REST API for accounts and transactions |
| **Friendbot**   | `http://localhost:8000/friendbot`    | Local test account funding faucet endpoint     |
| **Passphrase**  | `Standalone Network ; February 2017` | Network passphrase for transaction signing     |

#### Funding a Test Account with Local Friendbot

To create and fund a test account locally without waiting for Testnet friendbot:

```bash
# Generate or supply your test public key (e.g. from Freighter or stellar-cli)
TEST_PUBLIC_KEY="GDJ5J4K7K54P4..."

# Fund with 10,000 local XLM via curl
curl -X GET "http://localhost:8000/friendbot?addr=${TEST_PUBLIC_KEY}"
```

A successful response returns JSON with transaction ledger details:

```json
{
  "successful": true,
  "result_meta_xdr": "..."
}
```

#### Configuring `.env.local` for Standalone Mode

To connect OphirPay to your local standalone network:

```env
# Stellar Standalone Network Configuration
NEXT_PUBLIC_STELLAR_NETWORK="STANDALONE"
NEXT_PUBLIC_STELLAR_RPC_URL="http://localhost:8000/soroban/rpc"
NEXT_PUBLIC_STELLAR_HORIZON_URL="http://localhost:8000"
STELLAR_NETWORK_PASSPHRASE="Standalone Network ; February 2017"
```

#### Troubleshooting & Healthcheck Tips

- **Container Healthcheck / Startup Delays:** The Soroban RPC service within the quickstart container typically requires 10–25 seconds after container launch to initialize PostgreSQL, core ledgers, and captive core. Verify readiness before deploying contracts:
  ```bash
  # Check Soroban RPC health
  curl -s -X POST "http://localhost:8000/soroban/rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
  # Expected response: {"jsonrpc":"2.0","id":1,"result":{"status":"healthy"}}
  ```
- **Port 8000 Conflict:** If port 8000 is already occupied on your host machine, map to an alternate port (e.g. `-p 8001:8000`) and update your RPC/Horizon URLs to port `8001`.
- **Docker Resource Allocation:** On macOS and Linux, ensure Docker is allocated at least 2 CPUs and 2 GB RAM. Low memory limits can cause container core timeouts.
- **Stopping and Resetting:** To terminate the container:
  ```bash
  docker stop stellar-standalone
  ```

> **Note on `.env` vs `.env.local`:** Next.js loads both, but `.env.local`
> overrides `.env` and is already git-ignored. Prefer `.env.local` so you never
> accidentally commit credentials.

---

## 2. Option A — SQLite (fastest, zero external services)

SQLite is perfect for local experiments, UI work, and running the unit-test
suite against a real database. The production schema is PostgreSQL, so two
**local, uncommitted** edits are required first (this is intentional — CI and
migrations must always validate the single canonical PostgreSQL schema; the
procedure is also documented at the top of `prisma/schema.prisma`).

`DATABASE_PROVIDER="sqlite"` does not switch Prisma's datasource by itself.
SQLite is not feature-equivalent: in particular, the checked-in
`ApiKey.scopes` scalar list and PostgreSQL migration history require
PostgreSQL. See the [Database Provider Compatibility guide](DATABASE_PROVIDERS.md)
for the exact type, transaction, raw SQL, migration, and data-transfer
limitations before choosing SQLite.

### 2.1 Point Prisma at SQLite

Edit `prisma/schema.prisma`:

1. **Swap the datasource block** — comment out the `postgresql` block and
   uncomment the `sqlite` block:

   ```prisma
   // datasource db {
   //   provider = "postgresql"
   //   url      = env("DATABASE_URL")
   //   directUrl = env("DIRECT_DATABASE_URL")
   // }
   datasource db {
     provider = "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

2. **Drop all five `@db.Decimal(18, 7)` annotations** — SQLite has no
   fixed-precision numeric type, so Prisma stores `Decimal` as its own
   arbitrary-precision text representation. (Search the file for
   `@db.Decimal` and delete the annotation on each occurrence.)

> The checked-in `ApiKey.scopes String[]` field is not supported by Prisma's
> SQLite connector. SQLite cannot provide full API-key scope support using
> only the datasource/Decimal edits above; use PostgreSQL when developing or
> testing API-key authorization.

### 2.2 Configure and initialize

```bash
# .env.local — database section
DATABASE_URL="file:./dev.db"
DATABASE_PROVIDER="sqlite"
# No DIRECT_DATABASE_URL needed for SQLite
```

```bash
# Create the schema (SQLite has no migrations — db push is the flow)
npx prisma db push
npx prisma generate

# Seed demo data (user, payments, batch, refunds, hooks) — see §3
npm run db:seed

# Launch the app
npm run dev
```

Open **http://localhost:3000**, connect Freighter, and you're live on Stellar
Testnet.

---

## 3. Option B — Neon (hosted PostgreSQL, production parity)

Neon is the recommended path when you want to exercise exactly what runs in
production (native PostgreSQL enums, `@db.Decimal`, connection pooling,
migrations). It has a generous free tier.

### 3.1 Create the project

1. Sign up / sign in at [neon.tech](https://neon.tech).
2. **Create a project** (region of your choice, default settings are fine).
3. From the project dashboard → **Connection Details**, grab **two** strings:
   - **Pooled connection string** — host looks like
     `ep-xxxx-yyyy-pooler.us-east-2.aws.neon.tech` — for the app
     (`DATABASE_URL`).
   - **Direct connection string** — host is `ep-xxxx-yyyy.us-east-2.aws.neon.tech`
     (no `-pooler`) — for Prisma migrations (`DIRECT_DATABASE_URL`).

> ⚠️ Prisma migrations need a direct connection rather than a pooled URL.
> The committed `schema.prisma` currently has `directUrl` commented out, so
> setting `DIRECT_DATABASE_URL` alone does not change Prisma CLI's active URL.
> For migration commands, set `DATABASE_URL` to the direct URL, or configure
> and validate Prisma's `directUrl` before relying on `DIRECT_DATABASE_URL`.

### 3.2 Configure and initialize

```bash
# .env.local — database section
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-yyyy-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
DIRECT_DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-yyyy.us-east-2.aws.neon.tech/neondb?sslmode=require"
DATABASE_PROVIDER="postgresql"
```

> Make sure the `?sslmode=require` query param is present on both strings —
> Neon only accepts TLS connections. The exact role/database name depends on
> your project (default database is usually `neondb`).

The sample above is suitable for the app runtime when the pooled URL is
desired. For the committed schema's migration commands, temporarily provide
the direct URL as `DATABASE_URL`, for example:

```bash
DATABASE_URL="******ep-xxxx-yyyy.us-east-2.aws.neon.tech/neondb?sslmode=require" npx prisma migrate deploy
```

`DIRECT_DATABASE_URL` is not automatically selected by the current datasource.

```bash
# Apply the committed migrations (creates all tables, enums, indexes)
npx prisma migrate deploy
npx prisma generate

# Seed demo data — see §3
npm run db:seed

# Launch the app
npm run dev
```

---

## 4. What the seed script does

OphirPay supports structured seed profiles via `prisma/seed.ts` and automated execution via `scripts/staging-seed.sh`:

### 4.1 Seed Profiles

| Profile                 | Command                                                  | Data Generated                                                                                                                                                                                                          | Target Environment                |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **`minimal`** (default) | `npm run db:seed:minimal`                                | 1 demo user, 5 payments, 1 batch, 4 refunds, 3 hooks                                                                                                                                                                    | Local quick development           |
| **`staging`**           | `npm run db:seed:staging` or `./scripts/staging-seed.sh` | 4 persona users (Merchant, Buyer, Approver, Auditor), 12 payments with 30-day history, 3 batches, recurrences, scheduled payments, payment links, 4 refunds, webhook + delivery events, 4 audit logs, sanitized API key | Staging & E2E integration testing |
| **`load`**              | `npm run db:seed:load`                                   | 1 user, 5 batches, 75 synthetic payments across XLM/USDC                                                                                                                                                                | Performance & query load testing  |

### 4.2 Staging Seed Script & Safety Guards

For staging environments, `./scripts/staging-seed.sh` automates schema synchronization and comprehensive multi-user test data provisioning:

```bash
./scripts/staging-seed.sh
```

**Production Safety Check:** Both `prisma/seed.ts` and `scripts/staging-seed.sh` inspect `DATABASE_URL` before execution. Seeding will immediately halt if the target URL contains production domain patterns (e.g., AWS RDS, Supabase, Neon production branches) or keywords (`prod`, `production`, `mainnet`, `live`) unless explicitly flagged as staging, test, or local.

**Data Sanitization:** All seeded emails use `@staging.ophirpay.example.com` or `@example.com`. No real user emails, live private keys, or sensitive API secrets are ever seeded into the database.

**Idempotency caveat:** Demo users are upserted, but transaction records are appended. To start completely clean:

```bash
# SQLite: delete the dev database file and re-push
rm -f prisma/dev.db
npx prisma db push && npm run db:seed

# Neon / PostgreSQL: truncate the tables (or use a fresh branch)
npx prisma db execute --stdin <<'SQL'
TRUNCATE "Payment", "Batch", "Refund", "NotificationHook", "User", "AuditLog", "ApiKey" CASCADE;
SQL
npm run db:seed:staging
```

---

## 5. Testnet funding (free XLM)

OphirPay runs against **Stellar Testnet** by default (`.env.example` defaults:
`NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`). Testnet XLM has no value — you get it
for free from the **Friendbot** faucet.

### 5.1 Friendbot (one-liner)

```bash
curl "https://friendbot.stellar.org?addr=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

Replace the address with your own `G…` public key (from Freighter). Success
returns a JSON `to`/`hash` envelope; the account is created + funded with
10,000 testnet XLM.

### 5.2 In-app flow

If you're signed in with a Freighter account that isn't funded yet, the app
surfaces a "fund via Friendbot" action that does the same call for you.

### 5.3 Alternatives & limits

- **Stellar Laboratory** — https://laboratory.stellar.org → _Create account_ →
  Testnet — same faucet, graphical.
- Friendbot is rate-limited per IP (~1 request / few seconds). If you get a
  `429`, wait and retry — the `scripts/testnet-integration.mjs` helper already
  bakes in retry/backoff for this.
- Funding is **Testnet only**. Switching to Mainnet (`NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC`)
  requires real XLM — see `docs/deployment-mainnet.md` before ever doing that.

### 5.4 Verify your account

```bash
curl -s "https://horizon-testnet.stellar.org/accounts/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" | head -c 300
```

A `200` with a `balances` array means you're funded.

---

## 6. Common gotchas

1. **Pooled vs direct URL (Neon)** — migrations need the direct URL. In the
   committed Prisma schema, the datasource reads `DATABASE_URL`; setting
   `DIRECT_DATABASE_URL` alone has no effect unless a `directUrl` is configured.
   For migration commands, use the direct URL as `DATABASE_URL`.
2. **`prisma generate` after installs** — Prisma Client is generated from the
   schema. If you see `PrismaClient is not configured` / unknown model errors,
   run `npx prisma generate` (and `npx prisma db push` if you changed the
   schema). `npm run db:validate` does both checks.
3. **SQLite schema edits must stay uncommitted** — commit the `postgresql`
   datasource and the `@db.Decimal` annotations; CI validates the canonical
   schema and runs migrations against PostgreSQL. Local SQLite edits are
   yours alone.
4. **`AUTH_SECRET` length** — must be ≥ 32 chars or sessions can't be issued.
   Generate one: `openssl rand -hex 32`. It's only _required_ in production,
   but set it locally to mirror prod behavior.
5. **`NEXT_PUBLIC_*` variables are baked at build time** — changing
   `NEXT_PUBLIC_STELLAR_NETWORK`, contract IDs, etc. requires restarting
   `npm run dev` (dev re-evaluates) and a fresh `npm run build` for production
   bundles.
6. **Node version** — the repo pins Node 24 (`.nvmrc`). Newer majors usually
   work, but if `next build` or Prisma acts up, switch: `nvm use`.
7. **Default contract IDs work out of the box** — `.env.example` ships with
   community Testnet contract IDs for OphirPay + Emitter, so you don't need to
   deploy contracts locally. To deploy your own: `./scripts/deploy-all.sh`
   and paste the returned IDs.
8. **Rate limiting is on by default** — the proxy limits API traffic to
   `RATE_LIMIT_RPM` (default 120 req/min per IP). Wallet-auth endpoints have
   stricter per-IP/per-account buckets (see `.env.example` "Rate Limiting"
   section). If you get spurious `429`s while testing, raise the limits.
9. **`DATABASE_URL` is required** — `src/lib/env.ts` fails fast at boot
   without it. The CI values (`postgresql://prisma:prisma@localhost:5432/…`)
   work if you run the local Postgres service from `docker-compose.yml`.
10. **Testnet RPC flakiness** — public Soroban testnet endpoints rate-limit.
    If contract simulations fail intermittently, retry; the app treats these
    as transient (see `docs/TROUBLESHOOTING.md`).

---

## 7. Verify everything works

```bash
# Boot the server
npm run dev

# Full CI pre-check (typecheck → lint → tests → build → deploy-config)
npm run ci
```

Smoke-test the API:

```bash
curl -s http://localhost:3000/api/health
# → { "success": true, "data": { "services": { "database": { "status": "up" } } } }
```

Optional extras:

- **Playwright E2E** — `npm run test:e2e` (needs a running production build +
  Postgres; see the `e2e-tests` job in `.github/workflows/ci.yml` for the exact
  recipe).
- **Testnet integration** — `npm run test:testnet` runs live RPC checks against
  Soroban Testnet (uses the Friendbot, see §5).
- **Redis-backed rate limiting** — set `REDIS_URL=redis://localhost:6379` and
  the route-level buckets switch from in-memory to shared
  (`docker-compose.yml` has a Redis service). The global edge limit in
  `src/proxy.ts` only becomes distributed with an `https://` REST Redis URL
  (Upstash-compatible); see `.env.example` for why.

---

_Related docs: [Deployment Guide](DEPLOYMENT.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Stellar 101](STELLAR_101.md) · [Database Schema](SCHEMA.md) · [Mainnet Runbook](MAINNET_RUNBOOK.md)_
