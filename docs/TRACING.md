# OpenTelemetry Tracing in OphirPay

OphirPay integrates OpenTelemetry (OTel) to provide end-to-end distributed tracing across API routes, Soroban smart contract interactions, Horizon ledger operations, and Prisma database queries.

---

## 1. Overview & Architecture

### The Problem
Previously, observability was bespoke:
- Request IDs and structured logs with redaction
- Prometheus counters and latency histograms
- SSE connection gauges

While this measured aggregate throughput and latency, it could not pinpoint **where a specific payment spent its time**:
- Did the delay occur during Next.js API route handling?
- Was it in Soroban transaction simulation?
- Was it waiting for Horizon ledger polling / ingestion?
- Was it during a Prisma database transaction?

### The Solution
With OpenTelemetry enabled, every payment generates a single distributed trace spanning:
1. **HTTP Handler (`withRequestLogging`)**: The inbound entrypoint (e.g. `POST /api/payments`).
2. **Prisma Operations (`prisma.ts`)**: Database writes and reads (e.g. `prisma.Payment.create`, `prisma.Payment.update`).
3. **Soroban Contract Invocations (`contracts.ts`)**: Simulation (`soroban.simulate`), transaction building (`soroban.invoke`), and submission (`soroban.submit`).
4. **Horizon Interactions (`stellar.ts`, `contracts.ts`, `payment-sync.ts`)**: Polling transaction status (`horizon.get_transaction`) and submitting transactions (`horizon.submit_transaction`).
5. **Outbound Fetch**: Automatic client spans with W3C `traceparent` context propagation.

---

## 2. Zero-Cost Opt-In Model

Tracing is **strictly disabled by default**:
- When tracing is disabled, span functions (`withSpan`) execute the wrapped function immediately with `NOOP_SPAN`.
- Zero span memory allocations, zero timer overhead, zero background network traffic.
- SDK registration in `src/instrumentation.ts` exits immediately without activating exporters or monkey-patches.

---

## 3. Configuration Reference

Configure tracing via environment variables (in `.env.local` or container environment):

| Variable | Default | Description |
|---|---|---|
| `ENABLE_TRACING` | `false` | Enable or disable OpenTelemetry tracing (`true` or `false`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `undefined` | OTLP HTTP collector endpoint (e.g. `http://localhost:4318` or `https://otel.mycompany.com`). |
| `OTEL_SERVICE_NAME` | `ophirpay` | Service name attached to all exported trace resources. |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Sampling policy (`parentbased_always_on`, `always_on`, `always_off`, `traceidratio`). |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Sampling ratio for `traceidratio` sampler (float from `0.0` to `1.0`). |

### Minimal Example
```bash
# Enable tracing with export to a local OpenTelemetry Collector / Jaeger
ENABLE_TRACING=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=ophirpay
```

---

## 4. Payment Trace Topology

A payment execution produces a single unified trace tree:

```
HTTP POST /api/payments (Kind: SERVER)
│   Attributes: request.id, http.method, http.target, http.status_code
│
├── prisma.Payment.create (Kind: CLIENT)
│     Attributes: db.system, db.operation, db.model, request.id
│
├── soroban.simulate (Kind: CLIENT)
│     Attributes: contract.id, contract.function, soroban.source, request.id
│
├── soroban.invoke (Kind: CLIENT)
│     Attributes: contract.id, contract.function, soroban.source, request.id
│
├── horizon.submit_transaction (Kind: CLIENT)
│     Attributes: stellar.tx_hash, horizon.operation, request.id
│
└── horizon.get_transaction (Kind: CLIENT)
      Attributes: stellar.tx_hash, horizon.operation, horizon.status, request.id
```

All spans in this hierarchy share:
- The same 128-bit `traceId`.
- Nested parent-child span linkage (`parentSpanId`).
- The correlating `request.id` attribute matching the HTTP `X-Request-Id` response header.

---

## 5. Correlating Logs and Traces

OphirPay couples distributed tracing with structured logging:
1. **Trace to Log**: Every span records `request.id`, matching the log entry's `requestId`.
2. **Log to Trace**: When tracing is enabled, `logger.ts` automatically attaches the active `traceId` and `spanId` to structured JSON logs:
   ```json
   {
     "timestamp": "2026-09-24T09:30:00.000Z",
     "level": "info",
     "message": "Payment created",
     "context": {
       "id": "cm12345",
       "amount": "100.5",
       "requestId": "a5e9b8f2-3c1d-4e5f-9a8b-7c6d5e4f3a2b",
       "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
       "spanId": "00f067aa0ba902b7"
     }
   }
   ```
3. **Response Headers**:
   - `X-Request-Id`: Request UUID.
   - `X-Trace-Id`: Hex-encoded 128-bit OpenTelemetry trace ID.
   - `traceparent`: W3C trace context format (`00-<traceId>-<spanId>-<flags>`).

---

## 6. PII & Attribute Redaction Policy

OphirPay adheres to a strict data minimization and redaction policy matching `src/lib/logger.ts`:

### ⛔ Never Exported (Redacted to `[REDACTED]` or Excluded)
- Payment memos (`memo`, `memos`)
- Email addresses (`email`, `emails`, or matching `*@*.*`)
- Secret keys (`S...` Stellar secret seeds, `SCHEDULED_PAYMENTS_SOURCE_SECRET`)
- Private keys, passwords, bearer tokens, session secrets
- API keys (`apiKey`, `api_key`, `authorization`, `token`)

### ✅ Safe Protocol Attributes (Exported)
- Protocol identifiers: `contract.id`, `stellar.tx_hash`, `stellar.network`
- Public addresses: `stellar.source_account`, `stellar.destination`, `stellar.payer`, `stellar.payee`
- Operations: `http.method`, `http.target`, `contract.function`, `db.operation`, `db.model`
- Metrics & metadata: `payment.amount`, `payment.asset`, `amount_stroops`, `http.status_code`
- Correlation: `request.id`

---

## 7. Sampling Policy

Sampling controls how many traces are recorded and exported to downstream storage:

1. **`parentbased_always_on` (Default)**:
   - If an incoming request includes a W3C `traceparent` header with the sampled flag set, OphirPay samples the trace.
   - If no parent trace exists (root request), 100% of traces are sampled.
   - Recommended for development and low-to-medium volume production.

2. **`traceidratio`**:
   - Probabilistic head sampling configured via `OTEL_TRACES_SAMPLER_ARG` (e.g. `0.05` for 5%).
   - Recommended for high-volume production deployments to control collector bandwidth and storage costs.

3. **`always_off`**:
   - Drops all traces while maintaining no-op runtime behaviour.

---

## 8. Local Setup with Jaeger

To inspect traces locally using Jaeger:

```yaml
# docker-compose.otel.yml
version: "3.8"
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686" # Jaeger UI
      - "4318:4318"   # OTLP HTTP receiver
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

1. Start Jaeger:
   ```bash
   docker compose -f docker-compose.otel.yml up -d
   ```
2. Configure `.env.local`:
   ```bash
   ENABLE_TRACING=true
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```
3. Open `http://localhost:16686` to search and view traces by `request.id` or service name `ophirpay`.
