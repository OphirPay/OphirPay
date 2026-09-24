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

### CI-optional

Load tests are **not** part of the required CI pipeline. They need a live
instance and a test DB, and their numbers are environment-dependent — running
them on shared CI runners produces noise, not signal. Treat them as a
developer-run gate: run before merging any change to a hot API path
(`src/app/api/**`, `src/lib/prisma.ts`, `src/proxy.ts`), and update the
baselines below when behavior intentionally changes.

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

## Dynamic Transaction Fee Recommendation & Horizon Fee Statistics

### Why Dynamic Fees Matter
Stellar base fees are not fixed constants. During surges in transaction volume, validator ledgers hit capacity limits and prioritize transactions with higher bids per operation. Transactions submitted with a static base fee of 100 stroops risk being delayed across multiple ledgers or dropped entirely from the mempool.

To guarantee high payment reliability without overpaying during quiet periods, OphirPay implements an intelligent fee recommendation engine in [`src/lib/fee-estimator.ts`](../src/lib/fee-estimator.ts).

### Horizon Statistics Ingestion
The fee engine monitors Horizon's `/fee_stats` endpoint, evaluating:
- **`last_ledger_base_fee`**: Current baseline fee mandated by the consensus protocol.
- **`ledger_capacity_usage`**: Proportion of maximum ledger capacity utilized (0.00 to 1.00).
- **`fee_charged` Percentiles**: Real fee distributions accepted into recent ledgers (`p50`, `p70`, `p90`, `p95`, `p99`).

### Aggressiveness Policies
Merchants and users can tailor fee urgency based on business requirements:
- **`conservative`**: Targets `p50` (median charged fee). If capacity usage exceeds 85%, gently bumps to `p70`. Best for non-urgent scheduled batches.
- **`standard` (Default)**: Targets `p70`. If capacity usage exceeds 75%, escalates to `p90`; if above 90%, escalates to `p95`. Recommended for standard payments and customer checkout flows.
- **`aggressive`**: Targets `p95`. During severe network congestion (>80% capacity usage), escalates to `p99` priority bidding to guarantee inclusion in the very next ledger.

### Caching & Fallback Resilience
- **30-Second TTL Cache (`FEE_CACHE_TTL_MS = 30_000`)**: Caches parsed fee statistics across ~5 Stellar ledgers, eliminating redundant Horizon roundtrips and preventing RPC rate-limiting.
- **Two-Tier Fallback Mechanism**:
  1. If Horizon RPC times out or errors, the engine checks for previously cached fee statistics. If available, it continues serving recommendations flagged with `basis: "cached"`.
  2. If Horizon is completely unreachable and no cache exists, the system automatically falls back to `DEFAULT_FALLBACK_BASE_FEE = 100` stroops, visibly flagging `isFallback: true` with a clear warning: *"Horizon unreachable — using fallback base fee"*.

### Fee Fidelity (Preview Equals Submission)
A core UX tenet of payment orchestration is that the fee shown to the user before signing must match the fee actually submitted. Both the single payment interface ([`src/app/send/page.tsx`](../src/app/send/page.tsx)) and the batch payment confirmation dialog ([`src/components/BatchConfirmDialog.tsx`](../src/components/BatchConfirmDialog.tsx)) inject the exact recommended base fee into `buildPaymentTx`, `buildPathPaymentStrictSendTx`, and `buildBatchPaymentTx`, ensuring complete fidelity between the review screen and the signed transaction envelope.

