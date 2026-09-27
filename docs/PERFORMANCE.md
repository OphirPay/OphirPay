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
- The SSE / connection-leak harness is
  [`scripts/sse-load-test.mjs`](../scripts/sse-load-test.mjs).
- The threshold gate used by CI is
  [`scripts/check-load-baselines.mjs`](../scripts/check-load-baselines.mjs); the
  thresholds it enforces live in
  [`tests/load/baselines.json`](../tests/load/baselines.json).
- [`scripts/create-load-test-key.mjs`](../scripts/create-load-test-key.mjs) mints
  the API key the authenticated endpoint needs (and can seed rows).

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
# Preferred: creates a dedicated load-test user + key (and revokes any previous
# load-test key), then prints LOAD_TEST_API_KEY=oph_…
LOAD_TEST_SEED_PAYMENTS=2000 node scripts/create-load-test-key.mjs
```

The script mirrors the key format in `src/lib/api-auth.ts` exactly —
`src/__tests__/load-test-key.test.ts` fails if the two drift apart.

<details>
<summary>Mint a key by hand instead</summary>

```bash
# Sign in via the UI, or mint a key directly (hash + prefix, see src/lib/api-auth.ts):
node -e '
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  // 32 CSPRNG bytes (issue #701); store the version-tagged digest.
  const raw = `oph_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = `v1:${crypto.createHash("sha256").update(raw).digest("hex")}`;
  await prisma.apiKey.create({ data: { name: "load-test", keyHash, prefix: raw.slice(0, 8), userId: "<your-user-id>" } });
  console.log(raw);
  await prisma.$disconnect();
})();
'
```

</details>

### 3. Run the load test

```bash
LOAD_TEST_API_KEY=oph_... node scripts/load-test.js            # run only
LOAD_TEST_API_KEY=oph_... node scripts/load-test.js --write-docs   # run + regenerate baselines below
LOAD_TEST_API_KEY=oph_... node scripts/load-test.js --json=tests/load/results/latest.json   # machine-readable results
```

`--json` writes the raw results **without** touching this document — it is what
the scheduled CI gate consumes. Add `--json=<path>` to pick the file, or use
bare `--json` to drop a timestamped file in `LOAD_TEST_OUTPUT_DIR`.

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

### CI-optional

Load tests are **not** part of the required CI pipeline. They need a live
instance and a test DB, and their numbers are environment-dependent — running
them on shared CI runners produces noise, not signal. Treat them as a
developer-run gate: run before merging any change to a hot API path
(`src/app/api/**`, `src/lib/prisma.ts`, `src/proxy.ts`), and update the
baselines below when behavior intentionally changes.

### Scheduled CI gate (weekly + manual dispatch)

The load tests *do* run on a schedule —
[`.github/workflows/load-test.yml`](../.github/workflows/load-test.yml) fires
**every Monday at 03:00 UTC** and on `workflow_dispatch` (with `duration`,
`connections`, `margin`, `sse_concurrency` and `seed_payments` inputs). It:

1. builds the app and starts the standalone server against a throwaway
   PostgreSQL + Redis,
2. mints a load-test API key and seeds rows (default 2,000 payments),
3. runs `scripts/load-test.js` and `scripts/sse-load-test.mjs` **unmodified**,
4. publishes their output plus the measured-vs-allowed table in the job summary
   and uploads `tests/load/results/` as an artifact, and
5. **fails the run** when a measured value exceeds its threshold, printing the
   measured value and the allowed ceiling.

This is a regression *tripwire*, not a PR gate: no PR is blocked on it.

### Thresholds are deliberate, not recorded

`tests/load/baselines.json` is a hand-maintained policy file — it holds the
worst documented row per endpoint (from the table below), and
`scripts/check-load-baselines.mjs` applies:

| Threshold | Compared as |
|---|---|
| `p95Ms`, `p99Ms` | measured ≤ threshold × `LOAD_TEST_MARGIN` (default **3**) — latency scales with runner hardware |
| `errorPct` | measured ≤ threshold (absolute) — transport errors per connection |
| `non2xxPct` | measured ≤ threshold (absolute) — 4xx/5xx per request (`null` for SSE) |

A new endpoint in `scripts/load-test.js` with no entry in the file **fails the
gate** rather than passing unmeasured.

### Updating the baselines deliberately

Baselines are only allowed to move as an explicit, reviewed decision:

1. Run the load test locally (or dispatch the workflow) and look at the numbers.
2. If the change is intentional (a real feature, a deliberate trade-off, a
   slower-but-correct query), update **`tests/load/baselines.json`** — change
   the value and extend its `note` with *why*.
3. If the reference hardware changed, use `node scripts/load-test.js --write-docs`
   to regenerate the informational table below, and adjust the JSON thresholds
   to match.
4. Say so in the PR body: which number moved, from what to what, and why.

Never raise a threshold to silence a genuine regression — the failure message
(`::error title=Load-test baseline exceeded::`) prints the measured value, the
allowed value and the endpoint, which is the whole point of the gate.

To try a stricter or looser run without editing the file, dispatch the workflow
with a different `margin` input (the value is echoed in the job summary).

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

## Read-path caching (#741)

The read-only endpoints below used to do their upstream work on **every**
request — one Soroban simulation per call for the contract-backed reads, four
aggregate queries for `/api/analytics`. They are now served through
`src/lib/api-cache.ts`:

| Endpoint | Upstream work per request (before) | TTL (after) | Cache key |
|---|---|---:|---|
| `GET /api/stats` | 1 × `get_stats` simulation | 15 s | `stats:<contract>` |
| `GET /api/analytics` | 3 × `count` + 1 × `aggregate` + `groupBy` | 30 s | `analytics:<userId>` |
| `GET /api/contracts` | 2 × simulation (`get_version`, `get_owner`) | 60 s | `contracts:<contract>` |
| `GET /api/audit-log` (+ `/sse`, `/export`) | 1 × `get_audit_log_count` + 1 × `get_audit_entry` per entry | 5 s | `audit-log:count:<contract>`, `audit-log:entry:<contract>:<id>` |
| `GET /api/fee-config` (+ `/history`, `/collector`) | 1 × simulation each | 30 s | `fee-config:<contract>`, `fee-config:history:<contract>`, `fee-config:collector:<contract>` |

### Measured before/after

`src/__tests__/api-cache.benchmark.test.ts` measures the two paths in-process
(`npx vitest run src/__tests__/api-cache.benchmark.test.ts`). Upstream latency
is **simulated at 8 ms** — a real RPC round trip is not reproducible in CI, and
production round trips are tens of milliseconds, so this is the conservative
end of the range.

Measured 2026-09-24, 2 000 cache-hit samples against 25 miss samples:

| Path | Iterations | Avg latency |
|---|---:|---:|
| Uncached (pays the upstream call) | 25 | **8.21 ms** |
| Cache hit (L1, in-process) | 2 000 | **0.003 ms** |
| Speedup | | **~2 600×** |

Read as: the cache removes essentially all of the upstream cost, which is the
part that scales with load. The remaining per-request cost of a cached endpoint
is the route's own work (auth, JSON serialisation), unchanged from the numbers
in the baseline table above. L2 (Redis) hits add one round trip instead of an
RPC/DB call, so the win there is bounded by the network hop to Redis.

> Numbers are indicative, not contractual — re-run on your hardware. To extend
the end-to-end picture, add the cached endpoints to `scripts/load-test.js` and
regenerate the Baselines table.

### Invalidation matrix

Correctness does not depend on the TTL: every server-side mutation that changes
the data drops the affected keys immediately.

| Mutation | Invalidates |
|---|---|
| `POST /api/payments` (payment creation) | `stats`, `analytics:<userId>`, `audit-log` |
| `POST /api/refunds`, `PATCH /api/refunds/[id]` (audit writes) | `audit-log` |
| `POST /api/governance/execute` (proposal execution — can change fee config) | `fee-config`, `stats`, `audit-log` |

`invalidateCache(scope, subject?)` is the primitive: pass `subject` for
per-user payloads so one tenant's write never flushes another's cache, or omit
it to drop a whole scope. Any route can call it.

Writes that happen **outside** the API — transactions signed in the browser and
submitted straight to the chain — cannot be observed by the server, so those are
covered by the TTL alone (≤ 60 s, 5 s for the audit ledger).

### Intermediaries never cache these responses

Cached read responses carry `Cache-Control: private, no-cache, no-store,
must-revalidate` plus `X-Cache-Status: HIT|MISS` (`readCacheHeaders()` in
`src/lib/cache.ts`). The server-side cache is the only caching layer allowed to
serve them, and only for the length of the TTL — no browser or shared
intermediary may replay derived financial data. `X-Cache-Status` is what made
the measurements above observable.

### Redis is optional

Set `REDIS_URL` (see `.env.example` / `docker-compose.yml`) to share the cache
across replicas; the same variable already backs the rate limiter. With it
unset — or unset-but-unreachable — every read falls back to the per-process L1
cache and the request is served normally. The app must run correctly with
`REDIS_URL` unset, and `src/__tests__/api-cache.test.ts` asserts exactly that.

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
