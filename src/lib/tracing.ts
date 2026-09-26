// SPDX-License-Identifier: MIT

/**
 * OpenTelemetry tracing for the Node runtime (issue #815).
 *
 * One payment should be reconstructable as a single trace: the HTTP handler,
 * the Soroban simulation/submission (outbound fetch), the Horizon poll, and
 * the Prisma writes that follow. This module wires the upstream OTel Node SDK
 * with auto-instrumentation for HTTP and outbound fetch plus the Prisma
 * instrumentation, exporting OTLP/HTTP to a configurable backend.
 *
 * Design constraints:
 *
 *  - **Disabled by default, zero cost when off.** Nothing beyond
 *    `@opentelemetry/api` (a side-effect-free façade) is loaded unless
 *    `OTEL_ENABLED=true`; the SDK packages are pulled in through dynamic
 *    imports inside `initTracing()` so a disabled deployment pays no module
 *    load, no timers, and no background exporters.
 *  - **Correlate, don't compete.** The existing request id (minted in
 *    `src/proxy.ts`, threaded by `src/lib/request-logging.ts`) is attached to
 *    the active span as `ophirpay.request_id`, so logs and traces join on the
 *    same value instead of maintaining parallel id schemes.
 *  - **Defensive boundaries.** Every env var is validated with a safe
 *    fallback and a warning — a misconfigured optional tracer must never
 *    refuse to boot the payment service.
 *
 * @see docs/TRACING.md for the sampling policy and the attribute allow-list.
 */

import { trace } from "@opentelemetry/api";
import { logger } from "@/lib/logger";

/**
 * Span attribute that carries the platform request id so a trace can be
 * joined with the structured logs (and the `X-Request-Id` response header).
 */
export const REQUEST_ID_ATTRIBUTE = "ophirpay.request_id";

/** Traces path appended to the OTLP base endpoint. */
const TRACES_PATH = "/v1/traces";

/** Local-collector default; any OTLP/HTTP backend (Jaeger, Tempo, …) works. */
const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";

const DEFAULT_SERVICE_NAME = "ophirpay";

/**
 * Sampler names understood by the upstream SDK's env configuration
 * (`create-from-env`), mirrored here so we can validate before delegating.
 */
const VALID_SAMPLERS = new Set([
  "always_on",
  "always_off",
  "traceidratio",
  "parentbased_always_on",
  "parentbased_always_off",
  "parentbased_traceidratio",
]);

/** Default sampling: keep every trace that was sampled upstream. */
const DEFAULT_SAMPLER = "parentbased_always_on";
const DEFAULT_SAMPLER_ARG = 1;

/**
 * Cap on attribute length so a pathological inbound `X-Request-Id` cannot
 * bloat span payloads (the proxy mints ~20-char ids; UUIDs are 36).
 */
const MAX_REQUEST_ID_LENGTH = 128;

/** Fully validated tracing configuration derived from the environment. */
export interface TracingConfig {
  /** Whether the SDK should be started at all. */
  enabled: boolean;
  /** `service.name` resource attribute reported to the backend. */
  serviceName: string;
  /** OTLP/HTTP base endpoint (no `/v1/traces` suffix). */
  otlpEndpoint: string;
  /** Full traces URL handed to the exporter (`otlpEndpoint` + `/v1/traces`). */
  tracesUrl: string;
  /** Sampler name (delegated to the SDK via OTEL_TRACES_SAMPLER). */
  sampler: string;
  /** Sampler argument in [0, 1] (ratio for the *traceidratio samplers). */
  samplerArg: number;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Parse the enable flag. Tracing is opt-in: only an explicit truthy value
 * ("true"/"1"/"yes", case-insensitive) turns it on — unset, empty, or any
 * other value keeps the SDK off.
 */
export function isTracingEnabled(env: EnvLike = process.env): boolean {
  const raw = env.OTEL_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Validate the OTLP base endpoint, falling back to the local default. */
function resolveEndpoint(env: EnvLike): string {
  const raw = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return DEFAULT_OTLP_ENDPOINT;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`unsupported protocol "${url.protocol}"`);
    }
    // Strip a trailing slash so the /v1/traces join below is exact.
    return raw.replace(/\/+$/, "");
  } catch {
    logger.warn("Invalid OTEL_EXPORTER_OTLP_ENDPOINT — using default", {
      value: raw,
      fallback: DEFAULT_OTLP_ENDPOINT,
    });
    return DEFAULT_OTLP_ENDPOINT;
  }
}

/** Validate the sampler name, falling back to parentbased_always_on. */
function resolveSampler(env: EnvLike): string {
  const raw = env.OTEL_TRACES_SAMPLER?.trim();
  if (!raw) return DEFAULT_SAMPLER;
  if (VALID_SAMPLERS.has(raw)) return raw;
  logger.warn("Invalid OTEL_TRACES_SAMPLER — using default", {
    value: raw,
    fallback: DEFAULT_SAMPLER,
  });
  return DEFAULT_SAMPLER;
}

/** Validate the sampler argument, clamped to the [0, 1] ratio domain. */
function resolveSamplerArg(env: EnvLike): number {
  const raw = env.OTEL_TRACES_SAMPLER_ARG?.trim();
  if (!raw) return DEFAULT_SAMPLER_ARG;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    logger.warn("Invalid OTEL_TRACES_SAMPLER_ARG — using default", {
      value: raw,
      fallback: DEFAULT_SAMPLER_ARG,
    });
    return DEFAULT_SAMPLER_ARG;
  }
  return parsed;
}

/**
 * Resolve and validate the full tracing configuration from the environment.
 * Pure and total: every malformed input degrades to a documented default
 * with a warning instead of throwing.
 */
export function resolveTracingConfig(env: EnvLike = process.env): TracingConfig {
  const otlpEndpoint = resolveEndpoint(env);
  return {
    enabled: isTracingEnabled(env),
    serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    otlpEndpoint,
    tracesUrl: `${otlpEndpoint}${TRACES_PATH}`,
    sampler: resolveSampler(env),
    samplerArg: resolveSamplerArg(env),
  };
}

/**
 * Attach the current request id to the active span so traces and logs
 * correlate (acceptance criterion: the request id appears as a trace
 * attribute). Safe to call anywhere: with no SDK registered the API returns
 * a non-recording proxy span and this is a no-op; malformed ids are dropped
 * rather than exported.
 */
export function attachRequestIdToActiveSpan(requestId: string | undefined | null): void {
  if (typeof requestId !== "string") return;
  const trimmed = requestId.trim();
  if (!trimmed || trimmed.length > MAX_REQUEST_ID_LENGTH) return;
  try {
    const span = trace.getActiveSpan();
    span?.setAttribute(REQUEST_ID_ATTRIBUTE, trimmed);
  } catch {
    // The OTel API must never take down a request — swallow and move on.
  }
}

type StartedSdk = { start: () => void; shutdown: () => Promise<void> };

let sdk: StartedSdk | undefined;

/**
 * Start the OpenTelemetry SDK when `OTEL_ENABLED=true`; a no-op otherwise.
 * Returns whether the SDK was started. Failures are logged and swallowed:
 * tracing is strictly optional and must never prevent the service booting.
 */
export async function initTracing(env: EnvLike = process.env): Promise<boolean> {
  const config = resolveTracingConfig(env);
  if (!config.enabled || sdk) return false;

  try {
    // Delegate service name and sampling to the SDK's own env configuration
    // (avoids importing transitive @opentelemetry/* packages directly).
    env.OTEL_SERVICE_NAME ??= config.serviceName;
    env.OTEL_TRACES_SAMPLER ??= config.sampler;
    env.OTEL_TRACES_SAMPLER_ARG ??= String(config.samplerArg);

    const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }, { PrismaInstrumentation }] =
      await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/auto-instrumentations-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@prisma/instrumentation"),
      ]);

    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: config.tracesUrl }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs instrumentation is extremely noisy and adds no diagnostic
          // value for following a payment across services.
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-http": {
            // Health checks and the Prometheus scrape are hit constantly by
            // orchestrators; tracing them would drown the payment traces.
            ignoreIncomingRequestHook: (request) => {
              const url = request.url ?? "";
              return url.startsWith("/api/health") || url.startsWith("/api/metrics");
            },
          },
        }),
        // Prisma spans for every query the payment path writes. Requires the
        // `tracing` preview feature in prisma/schema.prisma (see docs).
        new PrismaInstrumentation(),
      ],
    });

    sdk.start();

    process.once("SIGTERM", () => {
      void shutdownTracing();
    });

    logger.info("OpenTelemetry tracing enabled", {
      serviceName: config.serviceName,
      endpoint: config.otlpEndpoint,
      sampler: config.sampler,
      samplerArg: config.samplerArg,
    });
    return true;
  } catch (error) {
    sdk = undefined;
    logger.warn("OpenTelemetry tracing unavailable — continuing without it", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Flush pending spans and stop the SDK (idempotent). */
export async function shutdownTracing(): Promise<void> {
  const running = sdk;
  sdk = undefined;
  if (!running) return;
  try {
    await running.shutdown();
  } catch (error) {
    logger.warn("OpenTelemetry shutdown failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
