// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  REQUEST_ID_ATTRIBUTE,
  attachRequestIdToActiveSpan,
  initTracing,
  isTracingEnabled,
  resolveTracingConfig,
  shutdownTracing,
} from "@/lib/tracing";
import { withRequestLogging } from "@/lib/request-logging";
import { logger } from "@/lib/logger";

afterEach(async () => {
  vi.restoreAllMocks();
  await shutdownTracing();
});

describe("isTracingEnabled", () => {
  it("is disabled when OTEL_ENABLED is unset (default: zero cost)", () => {
    expect(isTracingEnabled({})).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes", " Yes "])(
    "is enabled for explicit truthy value %j",
    (value) => {
      expect(isTracingEnabled({ OTEL_ENABLED: value })).toBe(true);
    }
  );

  it.each(["false", "0", "no", "on", "enabled", "2"])(
    "stays disabled for non-truthy value %j",
    (value) => {
      expect(isTracingEnabled({ OTEL_ENABLED: value })).toBe(false);
    }
  );
});

describe("resolveTracingConfig", () => {
  it("produces safe defaults from an empty environment", () => {
    const config = resolveTracingConfig({});
    expect(config).toEqual({
      enabled: false,
      serviceName: "ophirpay",
      otlpEndpoint: "http://localhost:4318",
      tracesUrl: "http://localhost:4318/v1/traces",
      sampler: "parentbased_always_on",
      samplerArg: 1,
    });
  });

  it("accepts a valid endpoint and strips trailing slashes before joining", () => {
    const config = resolveTracingConfig({
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com:4318/",
    });
    expect(config.enabled).toBe(true);
    expect(config.tracesUrl).toBe("https://otel.example.com:4318/v1/traces");
  });

  it("falls back to the default endpoint for malformed URLs without throwing", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const config = resolveTracingConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "::not a url::",
    });
    expect(config.otlpEndpoint).toBe("http://localhost:4318");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects non-http(s) endpoint protocols", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const config = resolveTracingConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "ftp://collector:4318",
    });
    expect(config.otlpEndpoint).toBe("http://localhost:4318");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default sampler for unknown sampler names", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const config = resolveTracingConfig({ OTEL_TRACES_SAMPLER: "coin_flip" });
    expect(config.sampler).toBe("parentbased_always_on");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(["parentbased_traceidratio", "traceidratio", "always_on", "always_off"])(
    "accepts valid sampler %j",
    (sampler) => {
      expect(resolveTracingConfig({ OTEL_TRACES_SAMPLER: sampler }).sampler).toBe(sampler);
    }
  );

  it.each(["-0.5", "2", "abc", "NaN", "Infinity"])(
    "falls back to sampler arg 1 for out-of-domain value %j",
    (value) => {
      vi.spyOn(logger, "warn").mockImplementation(() => {});
      expect(resolveTracingConfig({ OTEL_TRACES_SAMPLER_ARG: value }).samplerArg).toBe(1);
    }
  );

  it("accepts a boundary-valid sampler ratio", () => {
    expect(resolveTracingConfig({ OTEL_TRACES_SAMPLER_ARG: "0" }).samplerArg).toBe(0);
    expect(resolveTracingConfig({ OTEL_TRACES_SAMPLER_ARG: "0.25" }).samplerArg).toBe(0.25);
  });

  it("falls back to the default service name for blank values", () => {
    expect(resolveTracingConfig({ OTEL_SERVICE_NAME: "   " }).serviceName).toBe("ophirpay");
    expect(resolveTracingConfig({ OTEL_SERVICE_NAME: "billing" }).serviceName).toBe("billing");
  });
});

describe("attachRequestIdToActiveSpan", () => {
  it("is a no-op without a registered SDK and never throws", () => {
    expect(() => attachRequestIdToActiveSpan("req_abc_123")).not.toThrow();
  });

  it.each([undefined, null, "", "   ", 42 as unknown as string])(
    "drops malformed request id %j without throwing",
    (value) => {
      expect(() => attachRequestIdToActiveSpan(value)).not.toThrow();
    }
  );

  it("drops pathologically long request ids instead of bloating the span", () => {
    expect(() => attachRequestIdToActiveSpan("x".repeat(4096))).not.toThrow();
  });
});

describe("initTracing", () => {
  it("returns false and loads no SDK when disabled", async () => {
    const started = await initTracing({ OTEL_ENABLED: "false" });
    expect(started).toBe(false);
  });

  it("keeps the request-id attribute name stable for log/trace correlation", () => {
    expect(REQUEST_ID_ATTRIBUTE).toBe("ophirpay.request_id");
  });
});

describe("withRequestLogging boundary hardening", () => {
  it("logs malformed request URLs instead of crashing the wrapper", async () => {
    const spy = vi.spyOn(logger, "request").mockImplementation(() => {});
    const handler = withRequestLogging(async () => new Response("ok"));

    // A boundary input the old `new URL(req.url)` would have thrown on.
    const malformed = {
      method: "POST",
      url: "http://exa mple.com/%",
      headers: new Headers(),
    } as unknown as Request;

    const response = await handler(malformed);

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe("/");
  });

  it("handles requests with no headers object at the boundary", async () => {
    vi.spyOn(logger, "request").mockImplementation(() => {});
    const handler = withRequestLogging(async () => new Response("ok"));

    const bare = { method: "GET", url: "/api/ping" } as unknown as Request;
    const response = await handler(bare);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });
});
