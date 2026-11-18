# OpenTelemetry Tracing

> Distributed tracing for OphirPay: follow one payment across the HTTP
> handler, the Soroban contract call, the Horizon interaction and the
> database writes — in a single trace, correlated with the request id your
> logs already carry.

## Why

The existing telemetry answers _how many_ and _how slow_ (Prometheus counters
and latency histograms on `/api/metrics`) and _what happened_ (structured
logs with redaction and request ids). Neither reconstructs _where the time
went_ for one particular request. Tracing does: a single payment becomes one
trace whose spans cover the API handler, the Soroban simulation and
submission, the Horizon polls, and the Prisma writes — with per-span timing.

## Opt-in only

Tracing is **disabled by default**. Unless `OTEL_TRACING_ENABLED=true`:

- the OpenTelemetry SDK is never imported (`startTracing` returns before any
  dynamic `import()`), so cold start, memory and request latency are
  untouched;
- span helpers (`getTracer`, `getCurrentSpan`) return no-ops, so
  instrumentation call sites cost one boolean check;
- no exporter is constructed and no network egress happens.

Turning it on is a runtime decision, not a rebuild: set the env vars and
restart the server.

## Configuration

| Variable                      | Default                 | Meaning                                               |
| ----------------------------- | ----------------------- | ----------------------------------------------------- |
| `OTEL_TRACING_ENABLED`        | _(off)_                 | `true` starts the Node SDK at boot                    |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP collector endpoint                          |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json`             | `http/json` or `http/proto`                           |
| `OTEL_SERVICE_NAME`           | `ophirpay`              | Resource name attached to every span                  |
| `OTEL_TRACES_SAMPLER`         | `parentbased_always_on` | Sampler; `parentbased_traceidratio` for probabilistic |
| `OTEL_TRACES_SAMPLER_ARG`     | `0.1`                   | Ratio when using `traceidratio`                       |

Minimal local setup with a collector:

```bash
docker run --rm -p 4318:4318 otel/opentelemetry-collector-contrib:latest
OTEL_TRACING_ENABLED=true npm run dev
```

The export protocol/endpoint variables follow the standard OpenTelemetry
environment conventions, so any collector (Grafana Tempo, Jaeger, Datadog
Agent, Honeycomb, AWS X-Ray collector) works without code changes.

## Sampling policy

- **Development**: `parentbased_always_on` (the default) — every trace
  recorded, cheapest possible feedback loop.
- **Production**: `parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG`
  between `0.05` and `0.25` depending on traffic. The `parentbased` prefix
  keeps the decision consistent across services that share a trace.
- Payment submission flows are short-lived and low-volume relative to read
  traffic; if you need full fidelity on the _write_ path, sample at the
  collector instead (tail sampling on `ophirpay.payment_id` presence) rather
  than raising the head-sampling ratio.

## Request-id correlation

The proxy mints (or accepts) an `X-Request-Id`, returns it in the response
header, and the request-logging boundary stamps it onto every structured log
line. With tracing enabled the same id is written to the active span under:

```
ophirpay.request_id = <X-Request-Id>
```

The key is part of the attribute allowlist below, so it survives export.
Join logs to traces with `trace attributes["ophirpay.request_id"]` and traces
to logs with the standard `trace_id` field — the two systems correlate
instead of competing.

## Attribute policy (no PII)

Spans are exported off-host, so they get a stricter policy than logs. Only
attributes on this allowlist may be set or exported; everything else passed
to `safeSpanAttributes()` (or `span.setAttribute` through the tracer wrapper)
is dropped:

| Key                         | Example              | Notes                             |
| --------------------------- | -------------------- | --------------------------------- |
| `http.request.method`       | `POST`               |                                   |
| `http.route`                | `/api/payments/[id]` | Route template, not the raw URL   |
| `http.response.status_code` | `201`                |                                   |
| `server.address`            | `api.example.com`    |                                   |
| `url.path`                  | `/api/payments/p_1`  | Path only                         |
| `url.query`                 | `?window=30d`        | Never contains tokens             |
| `db.system`                 | `postgresql`         |                                   |
| `db.operation`              | `payments.create`    |                                   |
| `db.statement`              | parameterized SQL    | Never carries bound values        |
| `stellar.network`           | `TESTNET`            |                                   |
| `stellar.contract_id`       | `C…`                 | Contract ID, not a wallet address |
| `stellar.operation`         | `record_payment`     |                                   |
| `ophirpay.request_id`       | UUID                 | The correlation key               |
| `ophirpay.payment_id`       | `p_…`                | Application id                    |
| `ophirpay.batch_id`         | `b_…`                | Application id                    |
| `ophirpay.webhook_id`       | `w_…`                | Application id                    |
| `ophirpay.attempt`          | `2`                  | Delivery attempt number           |
| `error.type`                | `TimeoutError`       | Exception class name              |

Never attach to a span: wallet addresses or secret keys, memos, emails,
bearer tokens or API keys, raw request/response bodies, free-form user
input. The redaction rules in `src/lib/logger.ts` and the allowlist here are
two sides of the same policy — what cannot be logged cannot be traced.

## What a payment trace looks like

```
POST /api/payments  (server span, ophirpay.request_id=3f1c…)
├── middleware: rate limit / auth
├── prisma: payment.create
├── stellar: simulate  (soroban contract call)
├── stellar: submit    (sendTransaction)
└── stellar: poll horizon until confirmed
```

HTTP auto-instrumentation creates the server span; Prisma and outbound fetch
(spans 2–5) come from the Node auto-instrumentations; the manual
`stellar.*` spans wrap the contract helpers via `getTracer("stellar")`.

## Implementation map

- Gate + SDK bootstrap: `src/lib/tracing.ts` (`isTracingEnabled`,
  `startTracing`)
- Startup hook: `src/instrumentation.ts` (non-fatal on failure)
- Request-id stamping: `src/lib/request-logging.ts` (calls
  `getCurrentSpan()`)
- Attribute policy: `ALLOWED_SPAN_ATTRIBUTE_KEYS` in `src/lib/tracing.ts`
- Tests: `src/__tests__/tracing.test.ts`
