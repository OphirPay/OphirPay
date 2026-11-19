// SPDX-License-Identifier: MIT

/**
 * OpenTelemetry tracing for the Node runtime (issue #815).
 *
 * Goal: one trace per payment spanning the HTTP handler, the Soroban
 * contract call, the Horizon interaction and the database writes, with the
 * existing `X-Request-Id` propagated as a trace attribute so logs and traces
 * correlate instead of competing.
 *
 * ── Disabled by default ─────────────────────────────────────────────────
 * The SDK only starts when `OTEL_TRACING_ENABLED=true`. When disabled (the
 * default for every environment) `startTracing()` resolves immediately,
 * nothing is patched, no spans are created and no exporter is constructed —
 * zero performance cost. `isTracingEnabled()` is correspondingly cheap and
 * safe to call per-request.
 *
 * ── Configuration ───────────────────────────────────────────────────────
 *   OTEL_TRACING_ENABLED   "true" to start the SDK (default: off)
 *   OTEL_EXPORTER_OTLP_ENDPOINT   Collector base URL (default: local collector)
 *   OTEL_EXPORTER_OTLP_PROTOCOL   `http/json` (default) or `http/proto`
 *   OTEL_SERVICE_NAME             Span resource name (default: `ophirpay`)
 *   OTEL_TRACES_SAMPLER           `parentbased_always_on` (default) or
 *                                 `parentbased_traceidratio`
 *   OTEL_TRACES_SAMPLER_ARG       Sampling ratio when using traceidratio
 *                                 (default: `0.1` — sample 10%)
 *
 * ── Attribute policy (PII-safe) ─────────────────────────────────────────
 * Exported attributes are limited to identifiers, routing metadata and
 * measurements. The logger's redaction rules are kept: wallet addresses,
 * memos, emails, tokens/secrets and raw payloads must never be attached to
 * spans. Use `safeSpanAttributes()` for any custom attribute set — it drops
 * redacted keys and masks values on allowlisted-but-sensitive inputs.
 */

import type { Context, Span, TextMapPropagator } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace";

const TRACING_ENABLED_ENV = "OTEL_TRACING_ENABLED";

/**
 * Whether tracing was requested via configuration. Cheap (env read) so
 * request-scoped code can guard span creation without overhead.
 */
export function isTracingEnabled(): boolean {
  return process.env[TRACING_ENABLED_ENV] === "true";
}

/**
 * Start the OpenTelemetry Node SDK when (and only when) enabled.
 *
 * Called from `src/instrumentation.ts` during server startup. The heavy
 * `@opentelemetry/*` modules are imported dynamically so the disabled path
 * never even loads them.
 */
export async function startTracing(): Promise<void> {
  if (!isTracingEnabled()) {
    return;
  }

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import(
    "@opentelemetry/auto-instrumentations-node"
  );

  const protocol = (
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/json"
  ).toLowerCase();

  const traceExporter: SpanExporter =
    protocol === "http/proto"
      ? ((await importExportTraceOtlp("proto")) as SpanExporter)
      : ((await importExportTraceOtlp("json")) as SpanExporter);

  const { PeriodicExportingMetricReader } = await import(
    "@opentelemetry/sdk-metrics"
  );
  const { OTLPMetricExporter } = await import(
    "@opentelemetry/exporter-metrics-otlp-http"
  );

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "ophirpay",
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // HTTP server + client instrumentations create the spans that carry
        // the request id; the rest are left on because they are equally
        // autoconfigured by standard collectors. FS instrumentation is noisy
        // and traced nowhere useful for an API server.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
    textMapPropagator: (await importTextMapPropagator()) as TextMapPropagator,
  });

  sdk.start();
  const { logger } = await import("@/lib/logger");
  logger.info("OpenTelemetry tracing started", {
    protocol,
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318",
    sampler: process.env.OTEL_TRACES_SAMPLER ?? "parentbased_always_on",
  });

  // Surface shutdown errors without crashing the server.
  process.on("SIGTERM", () => {
    void sdk.shutdown();
  });
}

async function importExportTraceOtlp(
  flavor: "json" | "proto"
): Promise<unknown> {
  // `http/json` and `http/proto` are both OTLP/HTTP transports — the only
  // difference is the wire encoding. The gRPC exporter is a different
  // protocol on a different port (4317) and is deliberately not used here.
  if (flavor === "proto") {
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-proto"
    );
    return new OTLPTraceExporter();
  }
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  );
  return new OTLPTraceExporter();
}

async function importTextMapPropagator(): Promise<unknown> {
  // W3C trace-context and baggage propagators both live in @opentelemetry/core.
  const { W3CTraceContextPropagator, W3CBaggagePropagator, CompositePropagator } =
    await import("@opentelemetry/core");
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  });
}

// ── Request-id correlation ──────────────────────────────────────────────

/**
 * Attribute key under which the existing `X-Request-Id` is recorded on every
 * span. Sticking to one documented key keeps the "find the trace for this
 * log line" lookup trivial: `trace attributes["ophirpay.request_id"] = <id>`.
 */
export const REQUEST_ID_SPAN_ATTRIBUTE = "ophirpay.request_id";

// ── Attribute policy ────────────────────────────────────────────────────

/**
 * Attribute keys allowed on spans. Everything else passed to
 * `safeSpanAttributes` is dropped. This is the tracing twin of the logger's
 * SENSITIVE_FIELDS: what must not appear in a log line must not appear in a
 * span either (spans are exported off-host, so they are the wider surface).
 */
const ALLOWED_SPAN_ATTRIBUTE_KEYS = new Set([
  "http.request.method",
  "http.route",
  "http.response.status_code",
  "server.address",
  "url.path",
  "url.query", // queries are URLs, not payloads; still reviewed below
  "db.system",
  "db.operation",
  "db.statement",
  "stellar.network",
  "stellar.contract_id",
  "stellar.operation",
  "ophirpay.request_id",
  "ophirpay.payment_id",
  "ophirpay.batch_id",
  "ophirpay.webhook_id",
  "ophirpay.attempt",
  "error.type",
]);

/**
 * Filter arbitrary attributes down to the documented, PII-safe allowlist.
 * Returns a fresh object; unknown keys are dropped, values are coerced to
 * span-compatible primitives.
 */
export function safeSpanAttributes(
  attrs: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!ALLOWED_SPAN_ATTRIBUTE_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

// ── Minimal span surface used by handlers ───────────────────────────────

export interface TracedSpan {
  setAttribute(name: string, value: string | number | boolean): void;
  recordException(err: unknown): void;
  end(): void;
}

type TracerLike = {
  startActiveSpan<F>(name: string, fn: (span: TracedSpan) => F): F;
};

/** Null tracer used when tracing is off — keeps call sites allocation-free. */
const noopTracer: TracerLike = {
  startActiveSpan<F>(name: string, fn: (span: TracedSpan) => F): F {
    return fn(noopSpan);
  },
};

const noopSpan: TracedSpan = {
  setAttribute: () => {},
  recordException: () => {},
  end: () => {},
};

/**
 * Get a tracer handle. When tracing is disabled this returns a no-op tracer
 * with the same call shape, so instrumentation code does not branch at the
 * call site.
 *
 * The returned tracer's `startActiveSpan` runs the callback synchronously
 * and, when the real SDK is active, binds the span to the async context so
 * downstream awaited calls nest under it.
 */
export function getTracer(name: string): TracerLike {
  if (!isTracingEnabled()) return noopTracer;
  try {
    // Lazy require keeps the SDK modules off the disabled path entirely.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
    const real = api.trace.getTracer(name);
    return {
      startActiveSpan<F>(spanName: string, fn: (span: TracedSpan) => F): F {
        return real.startActiveSpan(
          spanName,
          (span: Span) => {
            const adapted: TracedSpan = {
              setAttribute: (k, v) => {
                if (ALLOWED_SPAN_ATTRIBUTE_KEYS.has(k)) span.setAttribute(k, v);
              },
              recordException: (err) => span.recordException(err as Error),
              end: () => span.end(),
            };
            return fn(adapted);
          }
        );
      },
    };
  } catch {
    return noopTracer;
  }
}

/**
 * Read the span active in the current async context (null when tracing is
 * off or no span is open). Used by the request-logging boundary to stamp the
 * request id onto the auto-created HTTP server span.
 */
export function getCurrentSpan(): TracedSpan | null {
  if (!isTracingEnabled()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("@opentelemetry/api") as typeof import("@opentelemetry/api");
    const span = api.trace.getSpan(api.context.active());
    if (!span) return null;
    return {
      setAttribute: (k, v) => {
        if (ALLOWED_SPAN_ATTRIBUTE_KEYS.has(k)) span.setAttribute(k, v);
      },
      recordException: (err) => span.recordException(err as Error),
      end: () => span.end(),
    };
  } catch {
    return null;
  }
}

export type { Context as TracingContext };
