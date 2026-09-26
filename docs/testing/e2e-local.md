# Running the E2E suite locally

The Playwright suite is **not** part of the branch (`ci.yml`) pipeline — it runs
in the nightly [`e2e-nightly.yml`](../../.github/workflows/e2e-nightly.yml)
workflow (02:00 UTC, and on demand via `workflow_dispatch`), which brings up its
own database and server — so a local run is the fast way to check it before
pushing. Locally the suite is not self-contained: `playwright.config.ts`
deliberately has **no `webServer` block**. The suite runs against a server
that is already live (a deployment, or one you start yourself), with
`http://localhost:3000` as the default target and `E2E_BASE_URL` as the
override. If nothing is listening on that port, the run fails immediately
with a connection error (`connect ECONNREFUSED 127.0.0.1:3000`) and no
explanation — this page is the explanation, and the state the server must be
in.

> **One command:** `npm run test:e2e:local` runs
> [`scripts/e2e-local.sh`](../../scripts/e2e-local.sh), which starts the app,
> waits for `/api/health`, runs the suite, and stops the server again (see
> §8). Everything below can also be done by hand.

## 1. Prerequisites

| Requirement | Details |
|---|---|
| Node.js 20 | Pinned by `.nvmrc` (`nvm use`). Newer majors usually work; use 20 to match CI. |
| Dependencies | `npm ci` (uses the lockfile; `npm install` also works). |
| Playwright browsers | `npx playwright install chromium firefox` — `chromium` covers the `chromium` and `mobile-chrome` projects, `firefox` the `firefox` project. |
| Database | PostgreSQL via `docker compose up -d db`, or any option in the [Local Development Guide](../LOCAL_DEV.md). The server refuses to boot without `DATABASE_URL`. |
| Environment files | `cp .env.example .env.local && cp .env.example .env` — see §2. |
| Seeded database | `npm run db:seed` — see §3. |

## 2. Environment variables

`src/lib/env.ts` validates the environment at boot and fails fast on a
missing required value. For E2E you need at least:

- `DATABASE_URL` — **required**.
- `NEXT_PUBLIC_CONTRACT_ID` and `NEXT_PUBLIC_EMITTER_CONTRACT_ID` —
  **required, no fallback**. The community Testnet IDs shipped in
  `.env.example` work as-is.
- `AUTH_SECRET` — optional, but set one locally (≥ 32 chars,
  `openssl rand -hex 32`) to mirror production behaviour.

Everything else (network, RPC/Horizon URLs, rate limits, …) has working
Testnet defaults in `.env.example`.

```bash
cp .env.example .env.local   # loaded by Next.js (build, dev, start)
cp .env.example .env         # loaded by the Prisma CLI and prisma/seed.ts

# Set DATABASE_URL in both files — e.g. for the Compose `db` service:
#   DATABASE_URL="postgresql://ophirpay:ophirpay@localhost:5432/ophirpay"
```

> **Why two files?** Next.js loads both `.env` and `.env.local`, but the
> Prisma CLI (`npx prisma migrate deploy`, `db push`) and
> `npm run db:seed` only read `.env` — a `DATABASE_URL` kept exclusively in
> `.env.local` fails with `Environment variable not found: DATABASE_URL`
> (Prisma CLI) or a PrismaClient initialization error (seed). Both files are
> git-ignored, so keep the values in sync — or put everything in `.env` and
> use `.env.local` only for machine-local overrides.

> ⚠️ `NEXT_PUBLIC_*` variables are inlined at **build** time. Set them in
> `.env` / `.env.local` before `npm run build`; changing them afterwards
> requires a rebuild (the dev server re-evaluates them on restart).

## 3. Database and seed

```bash
# Postgres from docker-compose (service `db`), then apply the committed migrations
docker compose up -d db
npx prisma migrate deploy   # reads DATABASE_URL from .env (see §2)
npx prisma generate

# Seed demo data (1 user, 5 payments, 1 batch, 4 refunds, 3 hooks)
npm run db:seed
```

`npm run db:seed` runs `prisma/seed.ts` via `tsx`. It is **not fully
idempotent**: the demo user is upserted, but payments, batches, refunds and
hooks are plain `create` calls — re-running it adds duplicate rows. See
[Local Development §4](../LOCAL_DEV.md#4-what-the-seed-script-does) for the
reset recipe.

## 4. Start the server (the requirement the config does not provide)

Nothing starts the app for you. Both options below must be up **before**
Playwright runs:

```bash
# Production build — recommended; the suite's default target is a deployed
# server, so a production build is the closest local equivalent.
npm run build
npm start          # http://localhost:3000

# ...or the dev server — faster to boot; routes compile on first hit.
npm run dev
```

Wait until it answers before running the suite. `/api/health` returns 200
only when the server is up *and* the database is reachable; a 503 means the
server is up but the DB is not:

```bash
curl -sf http://localhost:3000/api/health   # → 200, {"success":true,...}
```

> The health check pings Soroban RPC and Horizon (5 s timeouts each), so on a
> machine without a network route to Stellar it can take ~10 s to answer — it
> still returns 200, with `"status": "degraded"`.

Port 3000 already taken? Start elsewhere and point the suite at it:

```bash
npm start -- -p 3100
E2E_BASE_URL=http://localhost:3100 npm run test:e2e
```

To run against a deployment instead, set `E2E_BASE_URL` and skip the local
server entirely:

```bash
E2E_BASE_URL=https://ophirpay.vercel.app npm run test:e2e
```

## 5. The three Playwright configurations

| Configuration | Config file | Test directory | Projects | Command |
|---|---|---|---|---|
| Main E2E suite | `playwright.config.ts` | `e2e/` | `chromium`, `firefox`, `mobile-chrome` | `npm run test:e2e` |
| Visual regression | `playwright.visual.config.ts` | `tests/visual/` | `visual-chromium` | `npx playwright test -c playwright.visual.config.ts` |
| Accessibility | `playwright.config.ts` + `e2e/accessibility.spec.ts` | `e2e/` | `chromium`, `firefox`, `mobile-chrome` | `npm run test:a11y` |

- **Main** — the whole suite. `npm run test:e2e:ui` opens interactive UI mode.
  `retries` and `workers` are CI-only overrides; a local run never retries.
- **Visual** — screenshot comparison of Dashboard, Send, Batches and Contracts
  in light and dark themes. Heads-up: the suite currently fails before
  comparing anything — the snapshot names in the spec carry no `.png`
  extension, which Playwright 1.62 rejects (`Screenshot name "dashboard-light"
  must have a '.png' or '.webp' extension`), and no baselines are committed
  under `tests/visual/__screenshots__/` anyway (both tracked in issue #686).
  The `npm run test:visual` / `test:visual:update` aliases the README mentions
  are not defined in `package.json` either — use the `-c` command above, and
  add `--update-snapshots` to (re)generate baselines once the spec is fixed.
- **Accessibility** — axe-core scans (`@axe-core/playwright`) of five routes
  in both themes, run through the main config: `npm run test:a11y` is exactly
  `playwright test e2e/accessibility.spec.ts`. Heads-up: the scans currently
  report serious `color-contrast` violations on every route (they fail on all
  three projects, and on the deployed site too) — that is a pre-existing app
  issue, not a local-setup problem. A second a11y spec,
  `e2e/payments-a11y.spec.ts` (payments table), runs as part of the main
  suite.

## 6. Running and targeting

```bash
npm run test:e2e                                # every spec, all three projects
npm run test:e2e -- --project=chromium          # one project: chromium | firefox | mobile-chrome
npm run test:e2e -- e2e/titles.spec.ts          # one spec file
npm run test:e2e -- --shard=1/3                 # one shard of three (for parallel runs)
npm run test:e2e -- -g "page title"             # tests whose title matches
npm run test:e2e -- --repeat-each=5             # re-run each test to reproduce flakiness
npx playwright test --list                      # enumerate tests without running anything
```

`mobile-chrome` is the `Pixel 5` device preset (Chromium engine), so
`--project=chromium --project=mobile-chrome` only needs the chromium browser
installed. To scope the accessibility run to one browser:
`npx playwright test e2e/accessibility.spec.ts --project=chromium`.

## 7. Which specs need the mocked helpers

Two specs mock their network boundary instead of using the real one:

| Spec | Helper | What is mocked |
|---|---|---|
| `e2e/multisig-flow.spec.ts` | `e2e/helpers/stellar-mock.ts` | A fake `window.freighter` wallet plus Soroban RPC (`getLedgerEntries`, `simulateTransaction`, `sendTransaction`, `getTransaction`) and Horizon transaction responses. The multisig page calls the Stellar SDK directly from the browser (there is no app API route behind it), so a run without a wallet extension and without a funded Testnet contract is only possible by mocking the SDK's network boundary. |
| `e2e/notifications.spec.ts` | `e2e/helpers/sse-mock.ts` | `GET /api/events` is redirected to a local HTTP server that speaks `text/event-stream` and is driven by the test (emit / drop / reconnect), making SSE timing deterministic. |

Both helpers rely on `serviceWorkers: "block"` in `playwright.config.ts`:
without it, the PWA service worker intercepts `/api/` fetches with its own
client and Playwright's `page.route()` never sees the requests. Don't remove
that option.

Every other spec runs against the real app and the configured Testnet
endpoints (read-only contract simulations), so transient RPC failures can
surface as flaky runs rather than code bugs. Two specs inject their own
smaller init scripts without the shared helpers: `e2e/wallet-switch.spec.ts`
(fake Freighter + Albedo) and `e2e/accessibility.spec.ts` (forces the dark
theme).

## 8. The convenience script

```bash
npm run test:e2e:local                       # requires an existing build; starts `npm start`, runs all specs
npm run test:e2e:local -- --build            # run `npm run build` first
npm run test:e2e:local -- --dev              # use `npm run dev` instead of `npm start`
npm run test:e2e:local -- --seed             # run `npm run db:seed` before starting
npm run test:e2e:local -- --port 3100        # server port (default: 3000)
npm run test:e2e:local -- --keep-server      # leave the server running after the run
npm run test:e2e:local -- --project=chromium e2e/titles.spec.ts   # args pass through to Playwright
```

`scripts/e2e-local.sh` (also runnable directly as
`bash scripts/e2e-local.sh`) reuses a server that is already healthy on the
target port, waits up to `SERVER_WAIT_SECONDS` (default 120) for
`/api/health`, and stops the server it started via an `EXIT` trap — Ctrl+C
included. If `E2E_BASE_URL` is set, the script runs against it without
managing a server. `--seed` and `--build` only apply when the script starts
the server (they are skipped when an already-running server is reused).

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `connect ECONNREFUSED 127.0.0.1:3000` | No server on the default port — the config has no `webServer`. | Start the app (§4) or set `E2E_BASE_URL`. |
| `/api/health` answers `503` | Database unreachable. | Check `DATABASE_URL`; `docker compose up -d db`; `npx prisma migrate deploy`. |
| `Environment variable not found: DATABASE_URL` (Prisma CLI) or a PrismaClient init error (`npm run db:seed`) | Prisma reads `.env`, not `.env.local`. | Put `DATABASE_URL` in `.env` as well (§2). |
| Server logs `EADDRINUSE 0.0.0.0:8787` and stops responding | Another OphirPay instance (e.g. a dev server) already holds the WebSocket events port. | Stop the other instance, or start with `EVENTS_WS_PORT=8790`. |
| `next start` warns `"next start" does not work with "output: standalone"` | Expected on this repo — `next.config.ts` sets `output: "standalone"` for the Docker image. | Ignore it for local E2E; `npm start` serves normally (Docker uses `node .next/standalone/server.js`). |
| Pages render but lists are empty | Database not seeded. | `npm run db:seed`. |
| Run fails on missing browser executable | Playwright browsers not installed. | `npx playwright install chromium firefox`. |
| Intermittent `429` responses | Global rate limit (`RATE_LIMIT_RPM`, default 120/min per IP) hit by repeated runs. | Raise it in `.env.local` and restart. |
| A test fails once and passes on re-run | Local runs have no retries. | Reproduce with `--repeat-each`; see [flaky-tests.md](flaky-tests.md). |
| `NEXT_PUBLIC_*` change has no effect | They are inlined at build time. | Rebuild (`npm run build`) or restart the dev server. |

## Related

- [Flaky E2E tests](flaky-tests.md) — retries, annotations, reproduction.
- [Local Development Guide](../LOCAL_DEV.md) — database options and seed
  details.
- [Troubleshooting](../TROUBLESHOOTING.md) — environment and toolchain
  issues.
