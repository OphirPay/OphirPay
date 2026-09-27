// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #738 — the image shipped no HEALTHCHECK, and `/api/health` (which pings
 * the database, Soroban RPC, Horizon and Redis) was used for *both* probes, so a
 * transient dependency outage could restart-loop a healthy container.
 *
 * Liveness must stay dependency-free (`GET /api/health/live`) while readiness
 * keeps the dependency-aware check (`GET /api/health`). These tests pin the
 * endpoint behaviour and every manifest/doc that wires the two together.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load, loadAll } from "js-yaml";

import { GET } from "@/app/api/health/live/route";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("GET /api/health/live — liveness", () => {
  it("returns 200 with an explicit liveness marker", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.probe).toBe("liveness");
    expect(typeof body.data.uptime).toBe("number");
  });

  it("performs no dependency I/O (no DB, RPC, Horizon or Redis call)", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await GET();

    expect(fetchSpy).not.toHaveBeenCalled();
    // Source-level guard: a probe that reached for a dependency would restart
    // healthy containers during an outage, which is the bug this endpoint fixes.
    const source = read("src/app/api/health/live/route.ts");
    expect(source).not.toMatch(/@\/lib\/prisma/);
    expect(source).not.toMatch(/@\/lib\/stellar/);
    expect(source).not.toMatch(/fetch\(/);
  });

  it("stays reachable even when every dependency is down", async () => {
    // The route has no branches on dependency state by construction; two
    // consecutive probes must be identical apart from uptime.
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    expect(first.data.status).toBe(second.data.status);
    expect(first.data.probe).toBe(second.data.probe);
  });
});

describe("Kubernetes manifests — liveness vs readiness (issue #738)", () => {
  const containerOf = (file: string) => {
    const docs = loadAll(read(file)) as Array<Record<string, unknown>>;
    const deployment = docs.find(
      (d) => (d as { kind?: string }).kind === "Deployment"
    ) as {
      spec: {
        template: { spec: { containers: Array<Record<string, unknown>> } };
      };
    };
    return deployment.spec.template.spec.containers[0] as {
      livenessProbe: { httpGet: { path: string } };
      readinessProbe: { httpGet: { path: string } };
    };
  };

  it("k8s/deployment.yaml probes liveness and readiness separately", () => {
    const container = containerOf("k8s/deployment.yaml");
    expect(container.livenessProbe.httpGet.path).toBe("/api/health/live");
    expect(container.readinessProbe.httpGet.path).toBe("/api/health");
  });

  it("helm/ophirpay/values.yaml probes liveness and readiness separately", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      livenessProbe: { httpGet: { path: string } };
      readinessProbe: { httpGet: { path: string } };
    };
    expect(values.livenessProbe.httpGet.path).toBe("/api/health/live");
    expect(values.readinessProbe.httpGet.path).toBe("/api/health");
  });

  it("the Helm template still renders both probes from values", () => {
    const template = read("helm/ophirpay/templates/deployment.yaml");
    expect(template).toContain(".Values.livenessProbe");
    expect(template).toContain(".Values.readinessProbe");
  });
});

describe("Container health wiring (issue #738)", () => {
  it("the Dockerfile declares an exec-form HEALTHCHECK on the liveness endpoint", () => {
    const dockerfile = read("Dockerfile");
    const healthcheck = dockerfile
      .split("\n")
      .find((line) => line.startsWith("HEALTHCHECK"));
    expect(healthcheck, "no HEALTHCHECK instruction in the Dockerfile").toBeTruthy();

    // Distroless/docker-slim runner stages have no shell and no curl/wget, so
    // the probe must use the bundled node binary in exec form.
    expect(healthcheck).toContain('"node"');
    expect(healthcheck).toContain("/api/health/live");
    expect(healthcheck).not.toMatch(/\b(curl|wget)\b/);
    expect(healthcheck).toMatch(/--start-period=/);
    expect(healthcheck).toMatch(/--interval=/);
  });

  it("docker compose restarts the healthcheck so `up` shows the app going healthy", () => {
    const compose = load(read("docker-compose.yml")) as {
      services: {
        app: { healthcheck: { test: string[]; interval: string; start_period: string } };
      };
    };
    const test = compose.services.app.healthcheck.test;
    expect(test[0]).toBe("CMD");
    expect(test.join(" ")).toContain("/api/health/live");
    // Compose restates the Dockerfile timings so they are visible/tunable.
    expect(compose.services.app.healthcheck.interval).toBe("30s");
    expect(compose.services.app.healthcheck.start_period).toBe("20s");
  });

  it("the rate limiter exempts the whole /api/health subtree", () => {
    // Probes are hit far more often than the global limit allows, so throttling
    // them would make orchestrators restart healthy pods.
    const proxy = read("src/proxy.ts");
    expect(proxy).toContain('pathname.startsWith("/api/health/")');
    expect(proxy).toContain('pathname === "/api/health"');
  });
});

describe("Documentation — liveness vs readiness (issue #738)", () => {
  it("documents the split (and the Docker healthcheck) in the deployment guide", () => {
    const doc = read("docs/DEPLOYMENT.md");
    expect(doc).toMatch(/Liveness vs readiness/);
    expect(doc).toContain("/api/health/live");
    expect(doc).toContain("HEALTHCHECK");
    expect(doc).toMatch(/docker inspect/);
  });

  it("documents the liveness endpoint in the OpenAPI spec", () => {
    const spec = load(read("docs/openapi.yaml")) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    const live = spec.paths["/api/health/live"];
    expect(live, "/api/health/live missing from docs/openapi.yaml").toBeTruthy();
    expect(live!.get).toBeTruthy();
    expect(Object.keys(live!.get!.responses)).toContain("200");
  });
});
