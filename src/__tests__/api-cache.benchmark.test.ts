// SPDX-License-Identifier: MIT

/**
 * Issue #741 — measurement harness behind the "before/after" table in
 * docs/PERFORMANCE.md.
 *
 * The endpoint baselines in that document come from `scripts/load-test.js`
 * against a running instance. This harness measures the part that changed: the
 * cost of the upstream work a read-only endpoint does per request (a Soroban
 * simulation or a set of DB aggregates) versus the cost of serving the same
 * payload from the cache. It runs in-process, so it is deterministic and is
 * part of the normal suite.
 *
 * Upstream latency is *simulated* — a real RPC round trip is not reproducible
 * in CI. The simulated value is intentionally conservative; production
 * round trips are measured in tens of milliseconds, not single digits.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { cachedRead, invalidateCache, readCacheKey, resetReadCache } from "@/lib/api-cache";

/** Stand-in for the round trip the cached endpoints used to pay on every read. */
const SIMULATED_UPSTREAM_MS = 8;

const UPSTREAM_ITERATIONS = 25;
const CACHED_ITERATIONS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upstream(): Promise<{ totalPayments: number }> {
  await sleep(SIMULATED_UPSTREAM_MS);
  return { totalPayments: 1234 };
}

async function time(promise: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await promise();
  return performance.now() - started;
}

describe("read cache microbenchmark (#741)", () => {
  beforeEach(async () => {
    await resetReadCache();
  });

  it("serves a repeated read without paying the upstream cost again", async () => {
    const key = readCacheKey("analytics", "bench-user");

    const firstCall = await time(() => cachedRead(key, upstream, 30_000));

    // One fresh key per iteration, so every sample really is a miss that pays
    // the upstream cost — measuring the same key twice would measure the cache.
    let total = 0;
    for (let i = 0; i < UPSTREAM_ITERATIONS; i++) {
      const missKey = readCacheKey("analytics", `bench-miss-${i}`);
      total += await time(() => cachedRead(missKey, () => upstream(), 30_000));
    }
    const uncachedAvgMs = total / UPSTREAM_ITERATIONS;

    let cachedTotal = 0;
    for (let i = 0; i < CACHED_ITERATIONS; i++) {
      cachedTotal += await time(() => cachedRead(key, () => upstream(), 30_000));
    }
    const cachedAvgMs = cachedTotal / CACHED_ITERATIONS;

    console.log(
      [
        "",
        "Read-path cache microbenchmark (issue #741)",
        "| Path | Iterations | Avg latency |",
        "| --- | ---: | ---: |",
        `| Uncached (upstream call, simulated ${SIMULATED_UPSTREAM_MS} ms) | ${UPSTREAM_ITERATIONS} | ${uncachedAvgMs.toFixed(3)} ms |`,
        `| Cache hit (L1) | ${CACHED_ITERATIONS} | ${cachedAvgMs.toFixed(4)} ms |`,
        `| Speedup | | ${(uncachedAvgMs / cachedAvgMs).toFixed(0)}× |`,
        `| First (miss) read | 1 | ${firstCall.toFixed(3)} ms |`,
        "",
      ].join("\n")
    );

    // Loose bound, so a slow CI box doesn't flake: the cache must remove at
    // least 90 % of the upstream cost.
    expect(cachedAvgMs).toBeLessThan(uncachedAvgMs * 0.1);
  });

  it("a cache hit stays a cache hit after an unrelated scope is invalidated", async () => {
    const analyticsKey = readCacheKey("analytics", "bench-user-2");
    const statsKey = readCacheKey("stats");

    await cachedRead(analyticsKey, upstream, 30_000);
    await cachedRead(statsKey, upstream, 30_000);

    await invalidateCache("stats");

    const hit = await cachedRead(analyticsKey, upstream, 30_000);
    expect(hit.status).toBe("HIT");
  });
});
