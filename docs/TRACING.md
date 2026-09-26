# OpenTelemetry Tracing

OphirPay emits OpenTelemetry traces so a single payment can be followed
end-to-end: the API request, the Soroban simulation and submission, the
Horizon interaction, and the database writes that follow become **one trace**
instead of four unrelated log lines.

Tracing is **disabled by default** and costs nothing when off — the SDK is
never even loaded unless `OTEL_ENABLED=true`.

## Quick start

```bash
# 1. Run an OTLP backend (any OTLP/HTTP receiver works; Jaeger shown here)
docker run -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest

# 2. Enable tracing
OTEL_ENABLED=true npm run dev

# 3. Make a payment, then open http://localhost:16686 and search the
#    `ophirpay` service — or filter by the request id (see below).
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_ENABLED` | *(off)* | `true`/`1`/`yes` starts the SDK; anything else keeps it off. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP base URL of the backend. |
| `OTEL_SERVICE_NAME` | `ophirpay` | `service.name` resource attribute. |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Sampling policy (below). |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Ratio in `[0, 1]` for the `*traceidratio` samplers. |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Standard SDK variable; auth headers for SaaS backends are read natively by the exporter. |

Every variable is validated at startup (`src/lib/tracing.ts`): a malformed
value falls back to the documented default with a warning. A misconfigured
tracer never refuses to boot the payment service, and a failed SDK start
degrades to "no tracing" rather than a crash.

## Sampling policy

The sampler names are the standard OTel ones. Recommendation:

- **Local development / staging:** `parentbased_always_on` (the default) —
  every trace is kept, and a sampling decision made upstream is honored.
- **High-traffic production:** `parentbased_traceidratio` with
  `OTEL_TRACES_SAMPLER_ARG=0.1` (10 %) — statistically representative
  latency data without paying export costs for every request. Raise
  temporarily (or drop a `traceparent` header with the sampled flag) when
  hunting a specific intermittent failure.
- `always_off` is a kill switch that keeps the SDK warm but exports nothing.

Health checks (`/api/health*`) and the Prometheus scrape (`/api/metrics`)
are excluded from tracing — they are hit constantly by orchestrators and
would drown the payment traces.

## What a payment trace contains

| Hop | Produced by | Span kind |
|---|---|---|
| HTTP handler (`POST /api/payments`, …) | `@opentelemetry/instrumentation-http` | server |
| Soroban simulation & submission | `@opentelemetry/instrumentation-fetch` / `-undici` (outbound `fetch`) | client |
| Horizon poll / streaming request | same outbound fetch instrumentation | client |
| Database writes | `@prisma/instrumentation` | client |

The `fs` auto-instrumentation is explicitly disabled: it is extremely noisy
and adds no diagnostic value for following a payment.

## Correlating traces and logs

The platform already mints a request id in `src/proxy.ts`, returns it in the
`X-Request-Id` response header, and includes it in every structured log
line. The same value is attached to the active span as the attribute
**`ophirpay.request_id`** (set by `withRequestLogging` in
`src/lib/request-logging.ts`), so the two systems join on one key:

1. Reproduce the failure and grab `X-Request-Id` from the response (or the
   `requestId` field of the error log line).
2. Search the trace backend for `ophirpay.request_id = "<value>"`.
3. The trace shows where the payment spent its time — handler, contract
   call, Horizon, or database — instead of just "how many and how slow".

## Attribute & PII policy

Exported attributes must never carry PII — the same rule the logger's
redaction (`src/lib/logger.ts`) enforces. In practice:

**Safe (exported):**
- `ophirpay.request_id` — opaque correlation id, no user data.
- Standard HTTP semantic attributes (`http.method`, route-target, status
  code) — URL query strings are not exported.
- Prisma span metadata (operation, model) — bound parameter values are not
  exported.
- `service.name`, SDK and process resource attributes.

**Never exported:**
- Memos, emails, API keys, authorization headers, tokens, secrets,
  passwords — the logger's `SENSITIVE_FIELDS` list applies verbatim.
- Stellar secret keys (`S…`) and signed transaction XDR.
- Request/response bodies.

When adding a custom span attribute, ask: "would the logger print this?"
If not, it does not belong on a span either. Reviewers should treat new
attributes like new log fields and check them against the redaction rules.

## Operational notes

- **Zero cost when disabled:** with `OTEL_ENABLED` unset, only
  `@opentelemetry/api` (a side-effect-free façade) is loaded. No timers, no
  exporter, no background batching.
- **Graceful shutdown:** the SDK flushes pending spans on `SIGTERM`
  (`shutdownTracing()` in `src/lib/tracing.ts`).
- **Prisma spans** require no schema flag on Prisma ≥ 6.19 (the `tracing`
  preview feature was deprecated); older 6.x clients need
  `previewFeatures = ["tracing"]` in `prisma/schema.prisma`.
- The existing Prometheus counters/histograms (`/api/metrics`) are
  unaffected — traces answer "where did *this* payment spend its time",
  metrics keep answering "how many and how slow".
