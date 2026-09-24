# OpenTelemetry Tracing

## Overview
OpenTelemetry instrumentation for HTTP, Prisma, and `fetch` operations with request-id correlation. Traces span:
- API handlers
- Contract interactions (Soroban)
- Horizon polling
- Database writes

## Configuration
- **Sampling**: Controlled by `TRACE_SAMPLE_RATE` (0.0 = disabled).
- **Endpoint**: `OTLP_ENDPOINT` for OTLP/gRPC export.

## Safe Attributes
All exported attributes are redacted per existing policy. Explicitly safe:
- `http.request_id` (correlates with logs)
- `db.statement` (sanitized)
- `span.kind` (operation type)

## Redaction Rules
- **PII**: `password`, `secret`, `token`, `private_key` are always redacted.
- **Sensitive Data**: Never exported in traces.

## Example Trace
```
Root Span: API Request
  Child Span: Soroban Simulation
    Child Span: Horizon Poll
      Child Span: Prisma Write
```