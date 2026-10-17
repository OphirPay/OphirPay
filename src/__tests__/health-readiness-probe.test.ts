// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { load, loadAll } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/contracts", () => ({
  OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
}));

import prisma from "@/lib/prisma";
import {
  clearHealthCheckCache,
  GET as getHealth,
  HEALTH_DEPENDENCY_TIMEOUT_MS,
} from "@/app/api/health/route";
import {
  GET as getReady,
  READINESS_DB_TIMEOUT_MS,
} from "@/app/api/health/ready/route";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("Readiness probe timeout & health dependency budget (#1337)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearHealthCheckCache();
    process.env = { ...originalEnv };
    delete process.env.HEALTH_CACHE_TTL_MS;
    delete process.env.REDIS_URL;
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    clearHealthCheckCache();
  });

  it("GET /api/health/ready returns 200 when DB is reachable without calling external Horizon/RPC", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await getReady();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("ok");
    expect(body.data.probe).toBe("readiness");
    expect(body.data.database.status).toBe("ok");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GET /api/health/ready returns 503 when DB is unreachable", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    const res = await getReady();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.data.status).toBe("error");
    expect(body.data.database.status).toBe("error");
  });

  it("GET /api/health completes inside the readiness probe timeout even when Horizon stalls for 4s", async () => {
    // Simulate a stalled 4s Horizon response while RPC responds immediately
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("horizon")) {
        return new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true } as Response), 4_000),
        );
      }
      return Promise.resolve({ ok: true } as Response);
    }) as unknown as typeof fetch;

    const start = Date.now();
    const res = await getHealth(new Request("http://localhost/api/health"));
    const elapsedMs = Date.now() - start;

    expect(res.status).toBe(200);
    // Must complete near HEALTH_DEPENDENCY_TIMEOUT_MS (2s), well below the 5s K8s probe timeout
    expect(elapsedMs).toBeLessThan(3_000);

    const body = await res.json();
    expect(body.data.status).toBe("degraded");
    expect(body.data.services.database.status).toBe("ok");
    expect(body.data.services.stellar.horizon.status).toBe("error");
  });

  it("caches external RPC/Horizon health checks when HEALTH_CACHE_TTL_MS is enabled", async () => {
    process.env.HEALTH_CACHE_TTL_MS = "15000";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchSpy as unknown as typeof fetch;

    await getHealth(new Request("http://localhost/api/health"));
    expect(fetchSpy).toHaveBeenCalledTimes(2); // RPC + Horizon

    await getHealth(new Request("http://localhost/api/health"));
    // Second probe reuses cached external checks without hitting RPC/Horizon again
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("ensures readinessProbe.timeoutSeconds exceeds the health dependency timeout in Helm and K8s manifests", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      readinessProbe: { timeoutSeconds: number };
    };
    const docs = loadAll(read("k8s/deployment.yaml")) as Array<
      Record<string, unknown>
    >;
    const deployment = docs.find((d) => d.kind === "Deployment") as {
      spec: {
        template: {
          spec: {
            containers: Array<{
              readinessProbe: { timeoutSeconds: number };
            }>;
          };
        };
      };
    };

    const helmTimeoutMs = values.readinessProbe.timeoutSeconds * 1000;
    const k8sTimeoutMs =
      deployment.spec.template.spec.containers[0].readinessProbe
        .timeoutSeconds * 1000;

    expect(helmTimeoutMs).toBeGreaterThan(HEALTH_DEPENDENCY_TIMEOUT_MS);
    expect(helmTimeoutMs).toBeGreaterThan(READINESS_DB_TIMEOUT_MS);
    expect(k8sTimeoutMs).toBeGreaterThan(HEALTH_DEPENDENCY_TIMEOUT_MS);
  });
});
