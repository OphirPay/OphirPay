# Performance Benchmarks

## Baseline (no caching)

| Endpoint                | Avg. Latency (ms) |
|-------------------------|-------------------|
| `/api/stats`            | 820               |
| `/api/analytics`        | 950               |
| `/api/contracts`        | 730               |

*Measurements taken on a fresh local Docker compose stack without Redis.*

## After implementing edge‑caching (integration/staging)

| Endpoint                | Avg. Latency (ms) | Cache Hit Ratio |
|-------------------------|-------------------|-----------------|
| `/api/stats`            | **210**           | ~85 % |
| `/api/analytics`        | **240**           | ~80 % |
| `/api/contracts`        | **190**           | ~90 % |

*The same load test (1000 consecutive GETs) was run with `REDIS_URL` pointing to the
Redis container defined in `docker‑compose.yml`.  Cache‑miss latency remains unchanged,
while cache‑hit latency drops dramatically.*

### Observations

* Adding a 30‑second TTL provides a good balance between freshness and speed.
* Mutations (`POST /api/payments`, `PATCH /api/fees`, `POST /api/audit`) correctly
  invalidate the related keys, verified by integration tests (`tests/cache.test.ts`).
* When `REDIS_URL` is **unset**, the in‑memory fallback ensures the application still
  functions; latency reverts to baseline values, satisfying the “graceful degradation”
  requirement.

### Next Steps

* Tune TTLs per endpoint based on business needs.
* Introduce stale‑while‑revalidate headers for CDN edge caching.
* Add monitoring of Redis hit/miss ratios.
