// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
let requestIdGetter: (() => string | undefined) | null = null;

/** Register an external request ID provider (e.g. from request-logging). */
export function registerRequestIdGetter(getter: () => string | undefined): void {
  requestIdGetter = getter;
}

/** Retrieve the active request ID if registered. */
export function getCurrentRequestId(): string | undefined {
  return requestIdGetter ? requestIdGetter() : undefined;
}

/**
 * OpenTelemetry Tracing Integration for OphirPay.
 *
 * Provides distributed tracing across HTTP route handlers, Soroban contract calls,
 * Horizon API interactions, Prisma database operations, and outbound fetch requests.
 *
 * Tracing is strictly opt-in and disabled by default with zero performance cost:
 * when disabled, withSpan immediately invokes the target function without allocating
 * span objects, starting timers, or acquiring context locks.
 */

export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;
export type SpanStatusCode = (typeof SpanStatusCode)[keyof typeof SpanStatusCode];

export const SpanKind = {
  INTERNAL: 0,
  SERVER: 1,
  CLIENT: 2,
  PRODUCER: 3,
  CONSUMER: 4,
} as const;
export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind];

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export interface SpanEvent {
  name: string;
  timeUnixNano: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
  startTime?: number;
}

export interface TracingSpan {
  readonly name: string;
  readonly kind: SpanKind;
  readonly parentSpanId?: string;
  readonly startTimeMs: number;
  endTimeMs?: number;
  durationMs?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  spanContext(): SpanContext;
  setAttribute(key: string, value: unknown): this;
  setAttributes(attributes: Record<string, unknown>): this;
  setStatus(status: SpanStatus): this;
  recordException(exception: unknown): this;
  end(endTime?: number): void;
  isRecording(): boolean;
}

// ── Sensitive Fields & PII Redaction ──────────────────────────

const SENSITIVE_FIELD_NAMES = new Set([
  "memo",
  "memos",
  "email",
  "emails",
  "apikey",
  "api_key",
  "apiKey",
  "authorization",
  "token",
  "secret",
  "password",
  "key",
  "seed",
  "privatekey",
  "private_key",
  "privateKey",
  "secretkey",
  "secret_key",
  "secretKey",
  "passphrase",
  "bearer",
  "auth",
  "jwt",
]);

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const STELLAR_SECRET_KEY_REGEX = /S[A-Z0-9]{55}/g;

/**
 * Filter and redact sensitive fields and PII from trace attributes.
 * Conforms to the redaction rules established in src/lib/logger.ts.
 */
export function redactTraceAttributes(
  attributes: Record<string, unknown>
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, rawValue] of Object.entries(attributes)) {
    if (rawValue === undefined || rawValue === null) continue;

    const lowerKey = key.toLowerCase();
    const isSensitiveKey =
      SENSITIVE_FIELD_NAMES.has(key) ||
      SENSITIVE_FIELD_NAMES.has(lowerKey) ||
      lowerKey.includes("secret") ||
      lowerKey.includes("password") ||
      lowerKey.includes("token") ||
      lowerKey.includes("apikey") ||
      lowerKey.includes("private") ||
      lowerKey.includes("memo");

    if (isSensitiveKey) {
      result[key] = "[REDACTED]";
      continue;
    }

    if (typeof rawValue === "string") {
      let cleaned = rawValue.replace(EMAIL_REGEX, "[REDACTED]");
      cleaned = cleaned.replace(STELLAR_SECRET_KEY_REGEX, "[REDACTED_SECRET_KEY]");
      result[key] = cleaned;
    } else if (
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      result[key] = rawValue;
    } else if (rawValue instanceof Date) {
      result[key] = rawValue.toISOString();
    } else if (typeof rawValue === "object") {
      try {
        const json = JSON.stringify(rawValue);
        let cleaned = json.replace(EMAIL_REGEX, "[REDACTED]");
        cleaned = cleaned.replace(STELLAR_SECRET_KEY_REGEX, "[REDACTED_SECRET_KEY]");
        result[key] = cleaned;
      } catch {
        result[key] = "[Object]";
      }
    } else {
      result[key] = String(rawValue);
    }
  }

  return result;
}

// ── No-op Span (Zero Cost When Disabled) ──────────────────────

class NoopSpan implements TracingSpan {
  readonly name = "noop";
  readonly kind = SpanKind.INTERNAL;
  readonly startTimeMs = 0;
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  attributes: Record<string, string | number | boolean> = {};
  events: SpanEvent[] = [];

  spanContext(): SpanContext {
    return { traceId: "00000000000000000000000000000000", spanId: "0000000000000000", traceFlags: 0 };
  }
  setAttribute(): this { return this; }
  setAttributes(): this { return this; }
  setStatus(): this { return this; }
  recordException(): this { return this; }
  end(): void {}
  isRecording(): boolean { return false; }
}

export const NOOP_SPAN: TracingSpan = new NoopSpan();

// ── Span Implementation ───────────────────────────────────────

class ActiveSpan implements TracingSpan {
  readonly name: string;
  readonly kind: SpanKind;
  readonly parentSpanId?: string;
  readonly startTimeMs: number;
  endTimeMs?: number;
  durationMs?: number;
  status: SpanStatus = { code: SpanStatusCode.UNSET };
  attributes: Record<string, string | number | boolean> = {};
  events: SpanEvent[] = [];
  private readonly context: SpanContext;
  private ended = false;
  private readonly onEnd?: (span: ActiveSpan) => void;

  constructor(
    name: string,
    context: SpanContext,
    parentSpanId?: string,
    options?: SpanOptions,
    onEnd?: (span: ActiveSpan) => void
  ) {
    this.name = name;
    this.context = context;
    this.parentSpanId = parentSpanId;
    this.kind = options?.kind ?? SpanKind.INTERNAL;
    this.startTimeMs = options?.startTime ?? performance.now();
    this.onEnd = onEnd;

    if (options?.attributes) {
      this.setAttributes(options.attributes);
    }
  }

  spanContext(): SpanContext {
    return this.context;
  }

  setAttribute(key: string, value: unknown): this {
    if (this.ended) return this;
    const redacted = redactTraceAttributes({ [key]: value });
    if (key in redacted) {
      this.attributes[key] = redacted[key];
    }
    return this;
  }

  setAttributes(attributes: Record<string, unknown>): this {
    if (this.ended) return this;
    const redacted = redactTraceAttributes(attributes);
    Object.assign(this.attributes, redacted);
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (this.ended) return this;
    this.status = status;
    return this;
  }

  recordException(exception: unknown): this {
    if (this.ended) return this;
    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.events.push({
      name: "exception",
      timeUnixNano: Date.now() * 1_000_000,
      attributes: redactTraceAttributes({
        "exception.message": message,
        "exception.stacktrace": stack ?? "",
        "exception.type": exception instanceof Error ? exception.name : typeof exception,
      }),
    });
    return this;
  }

  end(endTime?: number): void {
    if (this.ended) return;
    this.ended = true;
    this.endTimeMs = endTime ?? performance.now();
    this.durationMs = Math.max(0, this.endTimeMs - this.startTimeMs);
    if (this.onEnd) {
      this.onEnd(this);
    }
  }

  isRecording(): boolean {
    return !this.ended;
  }
}

// ── Tracing Context & State ───────────────────────────────────

const activeSpanStorage = new AsyncLocalStorage<TracingSpan>();
const completedSpansBuffer: ActiveSpan[] = [];
let forcedTestingEnabled: boolean | null = null;
let originalGlobalFetch: typeof fetch | null = null;

function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Determine whether OpenTelemetry tracing is enabled.
 * Default is FALSE unless explicitly configured via ENABLE_TRACING=true
 * or OTEL_EXPORTER_OTLP_ENDPOINT.
 */
export function isTracingEnabled(): boolean {
  if (forcedTestingEnabled !== null) {
    return forcedTestingEnabled;
  }
  return (
    process.env.ENABLE_TRACING === "true" ||
    Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  );
}

/** Override tracing state for isolated unit testing. */
export function setTracingEnabledForTesting(enabled: boolean | null): void {
  forcedTestingEnabled = enabled;
}

/** Retrieve all completed spans from the local buffer (for testing and verification). */
export function getCompletedSpans(): ActiveSpan[] {
  return [...completedSpansBuffer];
}

/** Clear all stored completed spans. */
export function clearCompletedSpans(): void {
  completedSpansBuffer.length = 0;
}

/** Get the currently active span in the current async execution context. */
export function getActiveSpan(): TracingSpan | undefined {
  return activeSpanStorage.getStore();
}

/** Get the active traceId in the current async execution context, if any. */
export function getCurrentTraceId(): string | undefined {
  const span = getActiveSpan();
  if (span && span !== NOOP_SPAN) {
    return span.spanContext().traceId;
  }
  return undefined;
}

/** Get the active spanId in the current async execution context, if any. */
export function getCurrentSpanId(): string | undefined {
  const span = getActiveSpan();
  if (span && span !== NOOP_SPAN) {
    return span.spanContext().spanId;
  }
  return undefined;
}

// ── Sampling Policy ───────────────────────────────────────────

/**
 * Evaluates whether a new root trace should be sampled based on configured policy:
 * - parentbased_always_on (default): samples parent if sampled, otherwise 100%
 * - always_on: 100% sampling
 * - always_off: 0% sampling
 * - traceidratio: ratio determined by OTEL_TRACES_SAMPLER_ARG (0.0 to 1.0)
 */
function shouldSampleTrace(parentContext?: SpanContext): boolean {
  const sampler = (process.env.OTEL_TRACES_SAMPLER || "parentbased_always_on").toLowerCase();

  if (parentContext) {
    // If incoming parent context specifies traceFlags, respect it
    return (parentContext.traceFlags & 1) === 1;
  }

  if (sampler === "always_off") {
    return false;
  }
  if (sampler === "always_on" || sampler === "parentbased_always_on") {
    return true;
  }
  if (sampler === "traceidratio") {
    const ratio = parseFloat(process.env.OTEL_TRACES_SAMPLER_ARG || "1.0");
    return Math.random() < ratio;
  }
  return true;
}

// ── Core withSpan API ─────────────────────────────────────────

/**
 * Execute an async function within an active OpenTelemetry span.
 *
 * If tracing is disabled:
 * - Returns immediately by invoking fn(NOOP_SPAN) with ZERO performance overhead.
 *
 * If tracing is enabled:
 * - Automatically links to parent span in the current async context.
 * - Automatically attaches the current request.id to correlate with logs.
 * - Applies PII redaction to attributes.
 * - Sets span status to ERROR and records exceptions on throw.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: TracingSpan) => Promise<T> | T,
  options?: SpanOptions
): Promise<T> {
  if (!isTracingEnabled()) {
    return fn(NOOP_SPAN);
  }

  const parentSpan = getActiveSpan();
  const parentContext = parentSpan && parentSpan !== NOOP_SPAN ? parentSpan.spanContext() : undefined;

  const traceId = parentContext ? parentContext.traceId : generateTraceId();
  const spanId = generateSpanId();
  const isSampled = shouldSampleTrace(parentContext);
  const traceFlags = isSampled ? 1 : 0;

  const context: SpanContext = { traceId, spanId, traceFlags };

  const span = new ActiveSpan(
    name,
    context,
    parentContext?.spanId,
    options,
    (completed) => {
      if (isSampled) {
        completedSpansBuffer.push(completed);
        exportSpanToOtlp(completed).catch(() => {});
      }
    }
  );

  // Correlate with current request id if available
  const currentRequestId = getCurrentRequestId();
  if (currentRequestId) {
    span.setAttribute("request.id", currentRequestId);
  }

  return activeSpanStorage.run(span, async () => {
    try {
      const result = await fn(span);
      if (span.status.code === SpanStatusCode.UNSET) {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// ── OTLP HTTP Exporter ─────────────────────────────────────────

/**
 * Optional OTLP HTTP JSON exporter for configurable backends
 * (Jaeger, Grafana Tempo, Datadog, Honeycomb, or OpenTelemetry Collector).
 */
async function exportSpanToOtlp(span: ActiveSpan): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const tracesUrl = endpoint.endsWith("/v1/traces")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/v1/traces`;

  const serviceName = process.env.OTEL_SERVICE_NAME || "ophirpay";

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            { key: "service.version", value: { stringValue: "0.1.0" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "ophirpay.tracer", version: "0.1.0" },
            spans: [
              {
                traceId: span.spanContext().traceId,
                spanId: span.spanContext().spanId,
                parentSpanId: span.parentSpanId || "",
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: Math.floor(span.startTimeMs * 1_000_000),
                endTimeUnixNano: Math.floor((span.endTimeMs || performance.now()) * 1_000_000),
                attributes: Object.entries(span.attributes).map(([k, v]) => ({
                  key: k,
                  value:
                    typeof v === "number"
                      ? Number.isInteger(v)
                        ? { intValue: v }
                        : { doubleValue: v }
                      : typeof v === "boolean"
                      ? { boolValue: v }
                      : { stringValue: String(v) },
                })),
                status: {
                  code: span.status.code,
                  message: span.status.message || "",
                },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const res = await (originalGlobalFetch || fetch)(tracesUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      // Non-fatal; telemetry errors must never break application execution
    }
  } catch {
    // Swallow network/timeout issues on export
  }
}

// ── Outbound Fetch Instrumentation ────────────────────────────

/**
 * Instruments global fetch to produce client spans for outbound HTTP requests
 * and propagate W3C traceparent and X-Request-Id headers.
 */
export function instrumentFetch(): void {
  if (originalGlobalFetch || !isTracingEnabled()) {
    return;
  }

  originalGlobalFetch = globalThis.fetch;

  globalThis.fetch = async function tracedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    if (!isTracingEnabled()) {
      return (originalGlobalFetch as typeof fetch)(input, init);
    }

    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      return (originalGlobalFetch as typeof fetch)(input, init);
    }

    // Do not recursively trace OTLP export calls
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (otlpEndpoint && urlStr.startsWith(otlpEndpoint)) {
      return (originalGlobalFetch as typeof fetch)(input, init);
    }

    const method = (
      init?.method ??
      (typeof input === "object" && "method" in input
        ? (input as Request).method
        : "GET")
    ).toUpperCase();

    const spanName = `HTTP ${method} ${parsedUrl.host}`;

    return withSpan(
      spanName,
      async (span) => {
        const activeTraceId = getCurrentTraceId();
        const activeSpanId = getCurrentSpanId();
        const reqId = getCurrentRequestId();

        span.setAttributes(
          redactTraceAttributes({
            "http.method": method,
            "http.url": `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`,
            "http.host": parsedUrl.host,
            "net.peer.name": parsedUrl.hostname,
            "request.id": reqId,
          })
        );

        const headers = new Headers(
          init?.headers ??
            (typeof input === "object" && "headers" in input
              ? (input as Request).headers
              : {})
        );

        if (activeTraceId && activeSpanId) {
          headers.set("traceparent", `00-${activeTraceId}-${activeSpanId}-01`);
        }
        if (reqId && !headers.has("x-request-id")) {
          headers.set("x-request-id", reqId);
        }

        const updatedInit: RequestInit = { ...init, headers };

        try {
          const response = await (originalGlobalFetch as typeof fetch)(
            input,
            updatedInit
          );
          span.setAttribute("http.status_code", response.status);
          if (response.status >= 500) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${response.status}`,
            });
          }
          return response;
        } catch (err) {
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      },
      { kind: SpanKind.CLIENT }
    );
  };
}

/** Restores uninstrumented native fetch. */
export function restoreFetch(): void {
  if (originalGlobalFetch) {
    globalThis.fetch = originalGlobalFetch;
    originalGlobalFetch = null;
  }
}

// ── Startup & Shutdown ─────────────────────────────────────────

let isInitialized = false;

/**
 * Initialize OpenTelemetry tracing in Next.js instrumentation hook.
 * Disabled by default. Only initializes if ENABLE_TRACING=true or OTLP endpoint is set.
 */
export async function initTracing(): Promise<void> {
  if (!isTracingEnabled() || isInitialized) {
    return;
  }

  isInitialized = true;
  instrumentFetch();

  // Try initializing official @opentelemetry/sdk-node if present
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { Resource } = await import("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
      "@opentelemetry/semantic-conventions"
    );

    const sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "ophirpay",
        [ATTR_SERVICE_VERSION]: "0.1.0",
      }),
      traceExporter: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
        : undefined,
    });

    sdk.start();
  } catch {
    // SDK package not installed or failed to start; fallback lightweight tracing remains active.
  }
}

/**
 * Gracefully shuts down tracing and restores native hooks.
 */
export async function shutdownTracing(): Promise<void> {
  restoreFetch();
  isInitialized = false;
  clearCompletedSpans();
}
