# 🎭 Demo Mode & the Seeded Demo Environment

> **Goal:** document exactly what `NEXT_PUBLIC_DEMO_MODE` does today, what the
> demo seed scripts create, how to verify and tear the environment down, and how
> to produce the screenshots and the demo video with the scripts in `scripts/`.

This guide is deliberately literal about the current state of the code. Two
behaviours are easy to mis-document, so they are called out up front:

1. **Demo mode is not wired into the app yet** — `src/lib/demo-mode.ts` exports
   helpers, but nothing imports the module (§1).
2. **`scripts/demo-seed.sh` does not seed anything** — its seed step is a no-op;
   the real seed command is `npm run db:seed` (§2).

---

## 1. What `NEXT_PUBLIC_DEMO_MODE` actually does

### 1.1 The flag

| Where | What |
|---|---|
| `.env.example` | Declared (commented out) in the *Feature Flags* section |
| `src/lib/env.ts` | Optional string — no default, no validation, no effect on boot |
| `docs/DEPLOYMENT.md`, `docs/integration-guide.md` | Listed as an optional variable ("Enable demo mode") |
| `CHANGELOG.md` (`0.1.0-alpha`) | Describes demo mode as "simulated TXs, demo wallet with 10K XLM, pre-generated data" |

### 1.2 What the flag changes today: nothing

`src/lib/demo-mode.ts` reads the flag once at import time:

```ts
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
```

and exports helpers and fixtures:

- `isDemoMode()` — flag reader
- `simulatePayment()` / `simulateBatchPayment()` — instant, wallet-free demo payment records
- `generateDemoTxHash()` — `demo_…` placeholder transaction hashes
- `DEMO_WALLET` — a wallet object with a format-valid **testnet** address and a `10,000.00` display balance
- `DEMO_PAYMENTS`, `DEMO_EVENTS`, `DEMO_MULTISIG`, `DEMO_PROPOSALS` — pre-generated fixtures for the dashboard, activity feed, multisig and governance screens

**None of these are imported anywhere in the application.** The only reference
to the module outside itself is its coverage exclusion in `vitest.config.ts`.
Setting `NEXT_PUBLIC_DEMO_MODE=true` therefore changes nothing at runtime, and
— the part that matters for security review — **no safeguards are disabled by
this flag**: it does not bypass wallet authentication, it does not skip
transaction signing, it does not fake balances or transaction hashes in the UI,
and it does not short-circuit any API guard. Demo mode is dead code today; the
simulated-transaction behaviour described in the module docstring and in the
changelog is *intended* behaviour, not current behaviour.

> ⚠️ Do not rely on `NEXT_PUBLIC_DEMO_MODE=true` to make a demo work "without a
> wallet". To demo signed flows, use a funded Stellar **Testnet** account
> (Friendbot — see [LOCAL_DEV.md](LOCAL_DEV.md) §5).

> **Naming note:** `src/lib/transaction-simulator.ts` also exports a
> `simulatePayment()`. That module is unrelated to demo mode — it estimates
> fees against Horizon before the wallet signs.

### 1.3 What a demo therefore consists of

A demo is the real application plus a seeded local database (§2) plus a
connected Testnet wallet. The flag can be set (the seed script does) but it is
inert until the helpers in `src/lib/demo-mode.ts` are actually wired into the
wallet/payment flows.

---

## 2. Seeding the demo environment

### 2.1 What `scripts/demo-seed.sh` actually does

`./scripts/demo-seed.sh` runs these steps, in order:

| # | Step | Reality |
|---|---|---|
| 1 | Checks `node` is on `PATH` | No Node version check (the repo pins Node 20 in `.nvmrc`) |
| 2 | `npm install --silent` | Uses `npm install`, not the `npm ci` used by CI |
| 3 | `npx prisma generate` | Generates the Prisma client |
| 4 | `npx prisma db push --accept-data-loss` | Rewrites the schema of whatever `DATABASE_URL` points at. Requires `DATABASE_URL` **in `.env`** — the Prisma CLI does not read `.env.local`. Without it the script dies here with exit code 1 and **no error message** (stderr is redirected to `/dev/null`) |
| 5 | `npx prisma db seed` | **No-op.** `package.json` has no `prisma.seed` command, so Prisma exits 0 without seeding anything, and the script's "seed script not configured" fallback never fires. After the script completes, every table is empty |
| 6 | Writes `.env.local` | **Only if the file does not exist**, with `NEXT_PUBLIC_DEMO_MODE=true` and `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET`. An existing `.env.local` is left untouched |
| 7 | `npm run dev` | Starts the dev server (port 3000, or the next free port) |

**Consequence:** `./scripts/demo-seed.sh` alone does not produce a seeded demo.
It leaves an empty database and, on a fresh clone (no `.env`), it fails
silently at step 4.

### 2.2 The real seed: `npm run db:seed`

`npm run db:seed` runs `npx tsx prisma/seed.ts` and creates:

| Data | Details |
|---|---|
| **1 user** | `seed-user-1` — "OphirPay Demo", Stellar address `GACZ7ZEL…QM2U` (upserted) |
| **5 payments** | 3 `COMPLETED`, 1 `PENDING`, 1 `FAILED`, placeholder `transactionHash` (`seed-tx-hash`) |
| **1 batch** | "Demo Batch — Monthly Payroll" (`COMPLETED`) |
| **4 refunds** | One per status: `PROCESSED`, `APPROVED`, `REQUESTED`, `REJECTED` |
| **3 notification hooks** | `payment_recorded`, `refund_processed`, `escrow_created` → `https://example.com/webhooks/…` |

Exact output:

```
Seeding OphirPay database...
Seeded: 1 user, 5 payments, 1 batch, 4 refunds, 3 hooks
```

Re-running duplicates payments/batches/refunds/hooks (only the user is
upserted) — reset first (see §4 and [LOCAL_DEV.md](LOCAL_DEV.md) §4).

**Where the seeded rows are visible:** they belong to the demo user, and the
API routes that serve them (`/api/payments`, `/api/batches`, `/api/refunds`,
`/api/hooks`, `/api/audit-log`) require a wallet session or an API key. An
anonymous browser therefore shows empty/loading states even against a seeded
database. Inspect the rows directly with `npm run db:studio`, or connect the
wallet that owns them.

### 2.3 Reproducible recipe (the one that works)

```bash
# 1. Environment — required, and NOT created by demo-seed.sh
cp .env.example .env
#    then set DATABASE_URL to your database (SQLite or PostgreSQL, see LOCAL_DEV.md)

# 2. Dependencies + Prisma client
npm ci
npx prisma generate

# 3. Schema
npx prisma db push

# 4. The real seed
npm run db:seed

# 5. Demo flag (optional today — see §1): add to .env.local
#    NEXT_PUBLIC_DEMO_MODE=true
#    NEXT_PUBLIC_STELLAR_NETWORK=TESTNET

# 6. Run
npm run dev
```

`./scripts/demo-seed.sh` automates steps 2, 3 and 6 (plus `.env.local`) — run
step 4 yourself; it is the step that actually seeds.

---

## 3. Verifying the environment

### 3.1 `scripts/demo-test.sh` — currently broken

The script is *designed* to run six check blocks (environment, dependencies,
database, TypeScript, Vitest, production build) and print a pass/fail/warn
summary. **As committed it aborts after the first check**, exiting 1:

```
[1/6] Environment
  ✓ Node.js installed
```

Cause: under `set -euo pipefail`, `((PASS++))` evaluates to `0` while the
counter is `0`, so the arithmetic command returns exit status 1 and the shell
exits. The same applies to `((FAIL++))` and `((WARN++))`.

Until that is fixed, run the equivalent checks manually:

| Block | Command |
|---|---|
| Environment | `node -v` (expect v20.x — see `.nvmrc`) |
| Dependencies | `npm ci` |
| Database | `npx prisma db push` |
| TypeScript | `npx tsc --noEmit` |
| Tests | `npm test` |
| Build | `npx next build` |

### 3.2 Health endpoint

```bash
curl -s http://localhost:3000/api/health
# → {"success":true,"data":{"status":"ok","services":{"database":{"status":"ok"},
#    "stellar":{"network":"TESTNET","rpc":{"status":"ok"},"horizon":{"status":"ok"}}}}}
```

---

## 4. Teardown / reset

There is no teardown script. To undo the demo environment:

```bash
# 1. Stop the dev server (Ctrl-C in its terminal)

# 2. Remove the demo env file (gitignored) — or unset NEXT_PUBLIC_DEMO_MODE
rm -f .env.local

# 3. Reset the seeded rows
#    SQLite:
rm -f prisma/dev.db && npx prisma db push
#    PostgreSQL:
npx prisma db execute --stdin <<'SQL'
TRUNCATE "Payment", "Batch", "Refund", "NotificationHook", "User" CASCADE;
SQL

# 4. Remove video frame artifacts (gitignored; recreated on each run)
rm -rf .demo-frames
```

Captured screenshots (`public/screenshots/*.png`) are committed assets — if a
capture run overwrote them and you do not intend to keep the result, restore
them with `git checkout -- public/screenshots`.

---

## 5. Security and network rules

- **A demo must never point at Stellar Mainnet.** Keep
  `NEXT_PUBLIC_STELLAR_NETWORK=TESTNET` with the Testnet RPC/Horizon URLs and
  passphrase (the defaults in `.env.example`). Switching to `PUBLIC` targets
  live funds and requires a funded deployer — read
  [deployment-mainnet.md](deployment-mainnet.md) before ever doing that.
- `scripts/demo-seed.sh` runs `prisma db push --accept-data-loss`: it can drop
  data in whatever database `DATABASE_URL` points at. Never run it against a
  database you care about.
- `.env.local` is only written by the script when it does not already exist —
  if yours already sets `NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC`, the script will
  **not** change it. Check before demoing.
- `NEXT_PUBLIC_*` variables are inlined at build time; restart `npm run dev`
  (and rebuild for production) after changing them.
- Values the demo uses that are **not sensitive**: `NEXT_PUBLIC_DEMO_MODE`
  (`true`), `NEXT_PUBLIC_STELLAR_NETWORK` (`TESTNET`), the seeded demo public
  key `GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U`, and the
  community Testnet contract IDs committed in `.env.example`.
- Never put secrets in `NEXT_PUBLIC_*` variables, and keep `AUTH_SECRET`,
  `SCHEDULED_PAYMENTS_SOURCE_SECRET` and `CRON_SECRET` out of demo
  configurations, screenshots and recordings.
- `DEMO_WALLET.publicKey` in `src/lib/demo-mode.ts` is a format-valid but
  **unfunded** address — never send funds to it.

---

## 6. Screenshots

Prerequisites: a seeded, running environment on `http://localhost:3000` (§2)
and a Puppeteer Chrome build (`npm ci` normally downloads one; if not:
`npx puppeteer browsers install chrome`).

```bash
npm run dev                            # terminal 1 — the app must be up
node scripts/capture-screenshots.js    # terminal 2
```

The script (Puppeteer, headless, 1440×900, waits `networkidle2` + 1 s) captures
five pages into the committed `public/screenshots/` directory:

| Page | Output |
|---|---|
| `/` | `dashboard.png` |
| `/payments` | `payments.png` |
| `/send` | `send-payment.png` |
| `/batches` | `batches.png` |
| `/batches/new` | `batch-new.png` |

Notes:

- The script neither starts the server nor creates `public/screenshots/`.
- It captures the **anonymous** UI. Wallet-gated data (accounts, payments,
  batches…) renders as empty/loading states until a wallet is connected (§2.2).
- Per-page failures are logged (`❌ Failed: …`) and do not fail the run.
- `batches.png` and `batch-new.png` are produced by the script but are not
  currently committed.

---

## 7. Demo video

```bash
node scripts/create-demo-video.js
```

The script captures **the live Vercel deployment**
(`https://ophirpay.vercel.app`, hardcoded `BASE_URL`) — 15 slides × 10 frames
at 1 fps = 150 frames ≈ 2.5 minutes — then compiles them with ffmpeg into the
committed asset `public/demo.mp4` (H.264, yuv420p, 1280×720, `+faststart`).
Frames are written to `.demo-frames/` (gitignored, recreated on every run).

Requirements and caveats:

- **ffmpeg** must be available. Resolution order: `$FFMPEG_PATH` →
  `/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg` →
  `/tmp/ffmpeg-6.1.1-amd64-static/ffmpeg` → `ffmpeg` on `PATH`.
- **Chrome path is hardcoded** to
  `/home/codespace/.cache/puppeteer/chrome/linux-151.0.7922.47/chrome-linux64/chrome`
  (plus `/tmp/chrome-libs` on `LD_LIBRARY_PATH`). As committed, the script only
  runs in the Codespace-like environment it was written in; elsewhere it fails
  with `Browser was not found at the configured executablePath` — install that
  build at that path, or edit the constant to your local Chrome.
- Because `BASE_URL` is hardcoded to the deployed app, the video reflects
  **production, not your local seeded environment**. To record locally, point
  `BASE_URL` at `http://localhost:3000` (local edit — consider making it
  env-driven).
- The output overwrites the committed `public/demo.mp4` that the README embeds.

---

## 8. Known limitations (follow-ups)

| Area | Issue |
|---|---|
| `src/lib/demo-mode.ts` | Exported but never imported (dead code, excluded from coverage). Either wire it into the wallet/payment flows or delete it. |
| `scripts/demo-seed.sh` | Seed step is a no-op — replace `npx prisma db seed` with `npm run db:seed`. Also: fails silently without `.env` (stderr swallowed), uses `npm install` instead of `npm ci`, and never updates an existing `.env.local`. |
| `scripts/demo-test.sh` | Aborts after the first check (`set -e` + `((PASS++))`, §3.1). |
| `scripts/create-demo-video.js` | Hardcoded Chrome path; captures production only. |
| `public/screenshots/` | `batches.png` / `batch-new.png` are produced by the capture script but not committed. |

---

*Related docs: [Local Development Guide](LOCAL_DEV.md) · [Deployment Guide](DEPLOYMENT.md) · [Troubleshooting](TROUBLESHOOTING.md) · [Mainnet Runbook](MAINNET_RUNBOOK.md) · [Roadmap](../ROADMAP.md)*
