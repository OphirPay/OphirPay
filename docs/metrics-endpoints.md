# Per-Endpoint Metrics

Issue #197 — Per-endpoint latency histograms and error-rate metrics.

## What was added

Every API route handler is wrapped with `withMetrics(label, handler)` (see
`src/lib/metrics-middleware.ts`). The wrapper:

1. Records the request wall-clock duration.
2. Reads the HTTP status from the returned `Response`.
3. Classifies the status into a status class: `2xx`, `3xx`, `4xx`, `5xx`
   (thrown handler errors are recorded as `5xx`).
4. Stores a latency **histogram** and an **error count** keyed by
   `method + endpoint + status class`.

The endpoint key keeps dynamic route segments literal (e.g.
`/api/payments/[id]`), so each route produces a stable, bounded set of time
series instead of one series per concrete id.

## Exposed metrics (Prometheus text format at `/api/metrics`)

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `ophirpay_endpoint_request_duration_seconds` | histogram | `method`, `endpoint`, `status_class`, `le` | Request latency per endpoint + status class |
| `ophirpay_endpoint_errors_total` | counter | `method`, `endpoint`, `status_class` | Error counts per endpoint + status class |

Example scrape output:

```
# HELP ophirpay_endpoint_request_duration_seconds Request latency histogram per endpoint and status class
# TYPE ophirpay_endpoint_request_duration_seconds histogram
ophirpay_endpoint_request_duration_seconds_bucket{method="GET",endpoint="/api/payments",status_class="2xx",le="0.1"} 12
ophirpay_endpoint_request_duration_seconds_bucket{method="GET",endpoint="/api/payments",status_class="2xx",le="+Inf"} 12
ophirpay_endpoint_request_duration_seconds_sum{method="GET",endpoint="/api/payments",status_class="2xx"} 0.84
ophirpay_endpoint_request_duration_seconds_count{method="GET",endpoint="/api/payments",status_class="2xx"} 12
ophirpay_endpoint_errors_total{method="POST",endpoint="/api/payments",status_class="5xx"} 3
```

## Authentication (required)

`/api/metrics` exposes process memory, per-endpoint error rates and the live
SSE connection count, so it is **no longer public**. Every scrape must present a
credential; an unauthenticated request now returns `401` with **no metric body**:

| Credential | Header | Notes |
| --- | --- | --- |
| Scrape token | `Authorization: Bearer <METRICS_TOKEN>` | Preferred. Constant-time comparison against the `METRICS_TOKEN` env var. |
| API key | `Authorization: Bearer <key>` or `X-API-Key: <key>` | Must carry the `admin` scope (which implies every capability). |

The endpoint **fails closed**: if `METRICS_TOKEN` is unset and the request
carries no admin API key, the scrape gets `401`. Generate the token with
`openssl rand -hex 32` and set it wherever the app runs. The response format is
unchanged, so an existing scraper only needs the header:

```bash
curl -sS -H "Authorization: Bearer $METRICS_TOKEN" https://ophirpay.com/api/metrics
```

### Prometheus scrape config

The Helm chart renders `METRICS_TOKEN` from `helm/ophirpay/values.yaml`
(`secrets.METRICS_TOKEN`) into the `ophirpay-secrets` Secret. The
`prometheus.io/*` pod annotations still advertise the path, but annotations
cannot attach a header, so the scrape job must add the token itself:

```yaml
scrape_configs:
  - job_name: ophirpay
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/metrics-token  # value of METRICS_TOKEN
    static_configs:
      - targets: ["ophirpay.ophirpay.svc.cluster.local:80"]
```

For the Prometheus Operator, attach an `authorization` block (or a
`secret`/`credentials` reference) to the `ServiceMonitor`/`PodMonitor` instead.

## Usage

The metrics are in-process (reset on deploy), consistent with the existing
`http_requests_total` counters. Point Prometheus/Grafana at `/api/metrics`
(lifted from `monitoring/prometheus-alerts.yml`); the histogram and error
series can be used for latency SLOs and error-rate alerting per route.

## Implementation notes

- Wrapping is applied centrally to all route handlers under `src/app/api`
  via `withMetrics`, so new routes opt in automatically by exporting a
  wrapped handler.
- `src/lib/metrics-counters.ts` holds the storage and serialization helpers
  (`recordEndpointLatency`, `getEndpointMetrics`, `LATENCY_BUCKET_BOUNDS`).
