// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1424 — Add Docker container healthcheck instruction with deep
 * dependency verification.
 *
 * Verifies:
 *   • `Dockerfile` copies `scripts/healthcheck.js` into the standalone runner
 *     stage (`--from=builder /app/scripts/healthcheck.js ./scripts/healthcheck.js`)
 *     and declares `HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3`
 *     invoking `scripts/healthcheck.js`.
 *   • `docker-compose.yml` configures `app.healthcheck` invoking `scripts/healthcheck.js`
 *     and gates dependent startup on `condition: service_healthy`.
 *   • `scripts/healthcheck.js` accurately distinguishes healthy vs degraded vs
 *     unhealthy responses across both liveness (`/api/health/live`) and deep
 *     dependency readiness (`/api/health` / `--deep`) modes, including HTTP
 *     errors, timeouts, and database/RPC dependency outages.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { load } from "js-yaml";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  DEFAULT_TIMEOUT_MS,
  parseHealthcheckOptions,
  verifyHealthPayload,
  runHealthcheck,
} = require("../../scripts/healthcheck.js");

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function createMockHttpGet(behavior: {
  statusCode?: number;
  body?: string;
  emitTimeout?: boolean;
  emitError?: Error;
}) {
  return (_url: string, _opts: unknown, callback: (res: EventEmitter & { statusCode?: number; setEncoding: () => void }) => void) => {
    const req = new EventEmitter() as EventEmitter & { destroy: (err?: Error) => void };
    req.destroy = () => {};

    queueMicrotask(() => {
      if (behavior.emitTimeout) {
        req.emit("timeout");
        return;
      }
      if (behavior.emitError) {
        req.emit("error", behavior.emitError);
        return;
      }

      const res = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        setEncoding: () => void;
      };
      res.statusCode = behavior.statusCode ?? 200;
      res.setEncoding = () => {};
      callback(res);

      if (behavior.body !== undefined) {
        res.emit("data", behavior.body);
      }
      res.emit("end");
    });

    return req;
  };
}

describe("Docker healthcheck manifest wiring (issue #1424)", () => {
  it("bundles scripts/healthcheck.js into the standalone runner stage", () => {
    const dockerfile = read("Dockerfile");
    const runnerStage = dockerfile.split("FROM node:24-slim AS runner")[1] ?? "";
    expect(runnerStage).toContain(
      "COPY --chown=node:node --from=builder /app/scripts/healthcheck.js ./scripts/healthcheck.js"
    );
  });

  it("configures HEALTHCHECK with interval=30s, timeout=5s, start-period=15s, retries=3 invoking scripts/healthcheck.js", () => {
    const dockerfile = read("Dockerfile");
    const healthcheck = dockerfile
      .split("\n")
      .find((line) => line.startsWith("HEALTHCHECK"));

    expect(healthcheck).toBeTruthy();
    expect(healthcheck).toContain("--interval=30s");
    expect(healthcheck).toContain("--timeout=5s");
    expect(healthcheck).toContain("--start-period=15s");
    expect(healthcheck).toContain("--retries=3");
    expect(healthcheck).toContain('"scripts/healthcheck.js"');
    expect(healthcheck).toContain('"/api/health/live"');
  });

  it("wires docker-compose.yml app healthcheck to scripts/healthcheck.js and respects service_healthy dependencies", () => {
    const compose = load(read("docker-compose.yml")) as {
      services: {
        app: {
          depends_on: Record<string, { condition: string }>;
          healthcheck: {
            test: string[];
            interval: string;
            timeout: string;
            retries: number;
            start_period: string;
          };
        };
        db: { healthcheck: { test: string[] } };
        redis: { healthcheck: { test: string[] } };
      };
    };

    const app = compose.services.app;
    expect(app.healthcheck.test).toEqual([
      "CMD",
      "node",
      "scripts/healthcheck.js",
      "/api/health/live",
    ]);
    expect(app.healthcheck.interval).toBe("30s");
    expect(app.healthcheck.timeout).toBe("5s");
    expect(app.healthcheck.retries).toBe(3);
    expect(app.depends_on.db.condition).toBe("service_healthy");
    expect(app.depends_on.redis.condition).toBe("service_healthy");
  });
});

describe("scripts/healthcheck.js — deep dependency and liveness verification (issue #1424)", () => {
  it("parses default liveness options and switches to deep mode for /api/health or --deep", () => {
    const defaults = parseHealthcheckOptions([], {});
    expect(defaults).toEqual({
      host: "127.0.0.1",
      port: 3000,
      path: "/api/health/live",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      deep: false,
    });

    const deepViaFlag = parseHealthcheckOptions(["--deep"], { PORT: "4000" });
    expect(deepViaFlag.port).toBe(4000);
    expect(deepViaFlag.path).toBe("/api/health");
    expect(deepViaFlag.deep).toBe(true);

    const deepViaPath = parseHealthcheckOptions(["/api/health"], {});
    expect(deepViaPath.path).toBe("/api/health");
    expect(deepViaPath.deep).toBe(true);
  });

  it("verifies healthy liveness and deep readiness payloads", () => {
    expect(
      verifyHealthPayload(
        { success: true, data: { status: "ok", probe: "liveness" } },
        { deep: false }
      )
    ).toEqual({ healthy: true, reason: "ok" });

    expect(
      verifyHealthPayload(
        {
          success: true,
          data: {
            status: "ok",
            services: {
              database: { status: "up" },
              sorobanRpc: { status: "up" },
              horizon: { status: "up" },
            },
          },
        },
        { deep: true }
      )
    ).toEqual({ healthy: true, reason: "ok" });
  });

  it("fails deep verification when database or both Stellar upstreams are down", () => {
    const dbDown = verifyHealthPayload(
      {
        success: true,
        data: {
          status: "degraded",
          services: {
            database: { status: "down" },
            sorobanRpc: { status: "up" },
            horizon: { status: "up" },
          },
        },
      },
      { deep: true }
    );
    expect(dbDown.healthy).toBe(false);
    expect(dbDown.reason).toContain("database is down");

    const stellarDown = verifyHealthPayload(
      {
        success: true,
        data: {
          status: "degraded",
          services: {
            database: { status: "up" },
            sorobanRpc: { status: "down" },
            horizon: { status: "down" },
          },
        },
      },
      { deep: true }
    );
    expect(stellarDown.healthy).toBe(false);
    expect(stellarDown.reason).toContain("Soroban RPC and Horizon");
  });

  it("resolves healthy on HTTP 200 and unhealthy on HTTP 503, timeout, or connection error", async () => {
    const okResult = await runHealthcheck({
      path: "/api/health/live",
      deep: false,
      httpGet: createMockHttpGet({
        statusCode: 200,
        body: JSON.stringify({ success: true, data: { status: "ok", probe: "liveness" } }),
      }),
    });
    expect(okResult.healthy).toBe(true);
    expect(okResult.statusCode).toBe(200);

    const fail503 = await runHealthcheck({
      path: "/api/health",
      deep: true,
      httpGet: createMockHttpGet({
        statusCode: 503,
        body: JSON.stringify({ success: false, data: { status: "error" } }),
      }),
    });
    expect(fail503.healthy).toBe(false);
    expect(fail503.statusCode).toBe(503);

    const timeoutResult = await runHealthcheck({
      path: "/api/health/live",
      deep: false,
      httpGet: createMockHttpGet({ emitTimeout: true }),
    });
    expect(timeoutResult.healthy).toBe(false);
    expect(timeoutResult.reason).toBe("timeout");

    const errorResult = await runHealthcheck({
      path: "/api/health/live",
      deep: false,
      httpGet: createMockHttpGet({ emitError: new Error("ECONNREFUSED") }),
    });
    expect(errorResult.healthy).toBe(false);
    expect(errorResult.reason).toBe("ECONNREFUSED");
  });
});
