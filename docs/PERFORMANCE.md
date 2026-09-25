# OphirPay Performance & Load Testing

This document describes how to load-test the OphirPay API endpoints, records
the current baseline numbers, and explains what to do when you change
performance-sensitive code.

## Why this exists

Large payment accounts historically suffered timeouts on the payments list
API (see [issue #76](https://github.com/OphirPay/OphirPay/issues/76)) because
list queries returned unbounded result sets and used offset pagination with a
full-table `COUNT(*)`. Load tests catch these regressions early, before they
reach production.

## Tools

- **[autocannon](https://github.com/mcollina/autocannon)** (devDependency) —
  HTTP/1.1 benchmarking. Fast, dependency-free, and scriptable from Node.
- The repeatable driver is [`scripts/load-test.js`](../scripts/load-test.js).

## What is load-tested

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/health` | none | DB `SELECT 1`, Soroban RPC health, optional Redis ping |
| `GET /api/payments?limit=20` | API key (Bearer) | Authenticated list query (keyset pagination) |
| `GET /api/events` | none | SSE stream — measured as connection + first-byte latency, not throughput |

## How to run

### 1. Start a local instance against a test DB

```bash
# Postgres (or use your own test DB — SQLite also works for dev)
docker compose up -d db
cp .env.example .env.local   # point DATABASE_URL at the test DB
npx prisma db push
npx tsx prisma/seed.ts       # seed a user + payments
npm run dev
```

### 2. Generate an API key (for `/api/payments`)

```bash
# Sign in via the UI, or mint a key directly (hash + prefix, see src/lib/api-auth.ts):
node -e '
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const raw = `oph_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  await prisma.apiKey.create({ data: { name: "load-test", keyHash, prefix: raw.slice(0, 8), userId: "<your-user-id>" } });
  console.log(raw);
  await prisma.$disconnect();
})();
'
```

### 3. Run the load test

```bash
LOAD_TEST_API_KEY=oph_... node scripts/load-test.js            # run only
LOAD_TEST_API_KEY=oph_... node scripts/load-test.js --write-docs   # run + regenerate baselines below
```

Config (all optional):

| Env var | Default | Purpose |
|---|---|---|
| `LOAD_TEST_BASE_URL` | `http://localhost:3000` | Target instance |
| `LOAD_TEST_API_KEY` | *(unset)* | Bearer key for authenticated endpoints; unauthenticated endpoints are skipped with a warning when absent |
| `LOAD_TEST_DURATION` | `10` | Seconds per pass |
| `LOAD_TEST_CONNECTIONS` | `1,5,10,25,50` | Comma-separated concurrency levels |
| `LOAD_TEST_OUTPUT_DIR` | `tests/load/results` | Where raw JSON results are written |

Raw JSON results are written to `tests/load/results/` (gitignored) so you can
diff runs without polluting the repo.

### CI & Scheduled Regression Testing (CI-optional on PRs)

Load tests are **CI-optional** on regular pull request pushes to keep PR turnaround fast and avoid noisy numbers from shared ephemeral runners.

However, to prevent documented baselines from silently rotting and to catch performance regressions before production, the suite is scheduled automatically in CI:
- **Workflow:** [`.github/workflows/load-tests.yml`](../.github/workflows/load-tests.yml)
- **Schedule:** Weekly (Sundays at 03:00 UTC) and manually via `workflow_dispatch`.
- **Environment:** Dedicated Postgres 16 and Redis service containers against a compiled production Next.js build.
- **Enforcement:** Runs `node scripts/load-test.js` and `node scripts/sse-load-test.mjs` unmodified. The run asserts observed p95 latency and error rates against the committed baselines below within a configurable margin (`PERFORMANCE_MARGIN`, default +30%).
- **Reporting:** Publishes a Markdown table breakdown directly to the GitHub Job Summary and uploads JSON test metrics as a workflow artifact.
- **Failure condition:** If p95 latency or error rates exceed the documented baseline threshold, the CI run fails with the exact measured, baseline, and allowable values.

## What the numbers mean

- **Req/s** — throughput (autocannon's `requests.average`).
- **p50 / p95 / p99** — latency percentiles in ms. p95 is the headline number.
- **Error %** — transport-level errors (connection failures, timeouts).
- **Non-2xx %** — application-level failures (4xx/5xx responses). For
  `/api/payments`, a non-zero value usually means a missing/invalid API key.
- **SSE caveat** — `/api/events` holds connections open for the duration, so
  its req/s is inherently ≈ connections/s. Read its latency as
  "time to establish the stream and receive the `connected` event".

> Baselines are indicative, not contractual. Re-run on your own hardware
> before drawing conclusions — a laptop vs. a beefy CI box differs by 10–50×.

## Baselines (local reference run)

Generated on 2026-08-27T03:48:25.922Z against http://localhost:3000 (8s per pass). Regenerate with `node scripts/load-test.js --write-docs`.

| Endpoint | Connections | Req/s | p50 | p95 | p99 | Error % | Non-2xx % |
|---|---|---|---|---|---|---|---|
| /api/health | 1 | 9 | 100 ms | 187 ms | 276 ms | 0.00% | 0.00% |
| /api/health | 5 | 44 | 107 ms | 150 ms | 183 ms | 0.00% | 0.00% |
| /api/health | 10 | 79 | 122 ms | 174 ms | 204 ms | 0.00% | 0.00% |
| /api/health | 25 | 101 | 211 ms | 354 ms | 1211 ms | 0.00% | 0.00% |
| /api/health | 50 | 122 | 383 ms | 503 ms | 945 ms | 0.00% | 0.00% |
| /api/payments | 1 | 49 | 13 ms | 32 ms | 67 ms | 0.00% | 0.00% |
| /api/payments | 5 | 70 | 64 ms | 115 ms | 148 ms | 0.00% | 0.00% |
| /api/payments | 10 | 69 | 135 ms | 212 ms | 258 ms | 0.00% | 0.00% |
| /api/payments | 25 | 69 | 343 ms | 472 ms | 655 ms | 0.00% | 0.00% |
| /api/payments | 50 | 71 | 654 ms | 847 ms | 2103 ms | 0.00% | 0.00% |
| /api/events | 1 | n/a | - | - | - | 0.00% | n/a |
| /api/events | 5 | n/a | - | - | - | 0.00% | n/a |
| /api/events | 10 | n/a | - | - | - | 0.00% | n/a |
| /api/events | 25 | n/a | - | - | - | 0.00% | n/a |
| /api/events | 50 | n/a | - | - | - | 0.00% | n/a |
## Methodology

1. Each endpoint is exercised at each concurrency level in
   `LOAD_TEST_CONNECTIONS` for `LOAD_TEST_DURATION` seconds.
2. `/api/payments` is authenticated with the API key from
   `LOAD_TEST_API_KEY`; without it, the run is skipped and noted.
3. `/api/events` is limited to a short connection pass (SSE semantics).
4. Results are summarized (req/s, p50/p95/p99, error %, non-2xx %) and, with
   `--write-docs`, written back into the Baselines table above plus raw JSON
   under `tests/load/results/`.
5. Baseline runs should use a **test database with realistic row counts**
   (seed ≥ 2,000 payments) and a local instance; disable the global rate
   limiter (`RATE_LIMIT_RPM=100000`) or expect 429s to dominate the numbers.

## When to re-run

- Before/after touching: `src/app/api/payments/**`, `src/lib/prisma.ts`,
  pagination helpers, `src/proxy.ts`, or any query on a hot table.
- When adding a new endpoint that serves the dashboard.
- After a Prisma schema change that affects the `Payment` model.

## Interpreting regressions

If p95 or error rate worsens by >20% with no intentional change, suspect:

1. **Missing index** — add an index for the new filter/order combination
   (`prisma migrate dev --name add_index_...`).
2. **N+1 queries** — check for per-row awaits in the route (use
   `Promise.all` or `include`).
3. **Full-table scans** — confirm keyset pagination is being used (no `skip`
   on large offsets, no unconditional `COUNT(*)`).
4. **Rate limiting** — 429s masquerade as errors; confirm `RATE_LIMIT_RPM` is
   generous during baseline runs.

## How to update baselines deliberately

The numbers recorded in the **Baselines (local reference run)** table are committed to version control and act as the contract for CI regression tests. They must **never be casually updated** to mask real performance degradations.

### When to update baselines
Update baselines deliberately only when:
- An intended architectural change or query alteration changes the expected latency profile (and the trade-off is accepted by maintainers).
- A new route or concurrency profile is introduced into `scripts/load-test.js`.
- Performance improvements warrant ratcheting the thresholds lower to lock in optimizations.

### Procedure for updating baselines
Follow these steps whenever a baseline update is warranted:

1. **Prepare clean local test infrastructure:**
   Ensure Postgres and Redis services are running and the database is seeded:
   ```bash
   docker compose up -d db redis
   npx prisma db push
   npx tsx prisma/seed.ts
   ```

2. **Disable request throttling during the test:**
   Ensure `RATE_LIMIT_RPM=100000` is exported so HTTP 429s do not skew results.

3. **Build the production bundle:**
   Always benchmark against an optimized production build, not the development server:
   ```bash
   npm run build
   npm start &
   ```

4. **Generate a test API key:**
   ```bash
   export LOAD_TEST_API_KEY=$(node scripts/generate-load-test-key.mjs)
   ```

5. **Regenerate baselines with `--write-docs`:**
   ```bash
   LOAD_TEST_API_KEY=$LOAD_TEST_API_KEY node scripts/load-test.js --write-docs
   ```
   This automatically:
   - Measures p50, p95, p99, throughput, and error rates across all concurrency levels.
   - Updates the Markdown table in `docs/PERFORMANCE.md` between `## Baselines` and `## Methodology`.
   - Saves a raw JSON snapshot to `tests/load/results/`.

6. **Inspect the git diff:**
   ```bash
   git diff docs/PERFORMANCE.md
   ```
   Verify that only the intended endpoints and metrics shifted, and that the delta aligns with expectations.

7. **Commit with explicit rationale:**
   Commit the updated `docs/PERFORMANCE.md` with a descriptive message citing the reason for the change, measured before/after numbers, and the related PR or issue:
   ```bash
   git commit -m "perf(docs): update load test baselines after payments index optimization"
   ```

8. **Verify regression assertions:**
   Confirm that the regression check succeeds against the updated numbers:
   ```bash
   CHECK_REGRESSIONS=true LOAD_TEST_API_KEY=$LOAD_TEST_API_KEY node scripts/load-test.js
   ```

