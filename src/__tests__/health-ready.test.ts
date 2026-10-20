// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1337: Readiness probe timeout is shorter than the health route's
 * own dependency timeouts.
 *
 * Verifies that:
 * 1. `/api/health/ready` acts as a lightweight readiness probe that only checks
 *    the database (returning 200 on success, 503 on database failure).
 * 2. `/api/health/ready` performs zero external network calls (no RPC, Horizon, Redis).
 * 3. `/api/health` caches external checks with a short TTL so external endpoints
 *    are not hammered on every request.
 * 4. A slow or failing Horizon call does not crash or mark the database NotReady.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock contracts
vi.mock("@/lib/contracts", () => ({
  OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
}));

import prisma from "@/lib/prisma";
import { GET as getReady } from "@/app/api/health/ready/route";
import { GET as getHealth, resetHealthChecksCache, EXTERNAL_CHECKS_TTL_MS } from "@/app/api/health/route";

const originalFetch = global.fetch;

describe("GET /api/health/ready (issue #1337)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 200 when database connectivity check succeeds", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);

    const res = await getReady();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.probe).toBe("readiness");
    expect(body.data.services.database.status).toBe("ok");
    expect(typeof body.data.services.database.latencyMs).toBe("number");
    expect(typeof body.data.uptime).toBe("number");
  });

  it("returns 503 when database connectivity check fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("Database connection refused"));

    const res = await getReady();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("error");
    expect(body.data.probe).toBe("readiness");
    expect(body.data.services.database.status).toBe("error");
    expect(body.data.services.database.latencyMs).toBeNull();
  });

  it("performs no third-party network I/O (no Soroban RPC, Horizon, or Redis calls)", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);

    await getReady();
    expect(global.fetch).not.toHaveBeenCalled();

    // Source guard: verify route file does not import stellar or redis
    const routeSource = readFileSync(
      path.join(process.cwd(), "src/app/api/health/ready/route.ts"),
      "utf8"
    );
    expect(routeSource).not.toMatch(/@\/lib\/stellar/);
    expect(routeSource).not.toMatch(/@\/lib\/redis/);
    expect(routeSource).not.toMatch(/\bfetch\(/);
  });
});

describe("GET /api/health caching and concurrency (issue #1337)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthChecksCache();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("caches external check results across consecutive calls within TTL", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    // First call triggers network fetches
    const res1 = await getHealth(new Request("http://localhost/api/health"));
    expect(res1.status).toBe(200);
    const fetchCountFirst = vi.mocked(global.fetch).mock.calls.length;
    expect(fetchCountFirst).toBeGreaterThan(0);

    // Second call immediately within TTL should reuse cache and not call fetch again
    const res2 = await getHealth(new Request("http://localhost/api/health"));
    expect(res2.status).toBe(200);
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(fetchCountFirst);
  });

  it("refreshes external checks when resetHealthChecksCache is invoked", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    await getHealth(new Request("http://localhost/api/health"));
    const count1 = vi.mocked(global.fetch).mock.calls.length;

    resetHealthChecksCache();

    await getHealth(new Request("http://localhost/api/health"));
    const count2 = vi.mocked(global.fetch).mock.calls.length;
    expect(count2).toBeGreaterThan(count1);
  });

  it("answers with degraded when Horizon is down, but keeps database status ok", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
    // Horizon fails with network timeout / error
    vi.mocked(global.fetch).mockRejectedValue(new Error("Horizon request timed out"));

    const res = await getHealth(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status).toBe("degraded");
    expect(body.data.services.database.status).toBe("ok");
    expect(body.data.services.stellar.horizon.status).toBe("error");
  });
});
