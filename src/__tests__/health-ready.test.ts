// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock contracts
vi.mock("@/lib/contracts", () => {
  return {
    get OPHIRPAY_CONTRACT_ID() {
      return "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";
    },
  };
});

import prisma from "@/lib/prisma";
import { GET as getReady } from "@/app/api/health/ready/route";
import { GET as getHealth, resetHealthCacheForTests } from "@/app/api/health/route";

const originalFetch = global.fetch;

describe("GET /api/health/ready — lightweight readiness probe (#1337)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthCacheForTests();
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetHealthCacheForTests();
  });

  it("returns 200 OK with readiness probe marker when database is responsive", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);

    const res = await getReady();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.probe).toBe("readiness");
    expect(body.data.database.status).toBe("ok");
    expect(typeof body.data.database.latencyMs).toBe("number");
    expect(typeof body.data.uptime).toBe("number");
  });

  it("performs no external network I/O during readiness checks", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await getReady();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 Service Unavailable when database query fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("Connection refused"));

    const res = await getReady();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("error");
    expect(body.data.probe).toBe("readiness");
    expect(body.data.database.status).toBe("error");
    expect(body.data.database.latencyMs).toBeNull();
  });

  it("a slow or broken Horizon does not fail the readiness probe", async () => {
    // Database is healthy
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    // Horizon / external network is broken or hanging
    global.fetch = vi.fn().mockRejectedValue(new Error("Network timeout after 5000ms"));

    const res = await getReady();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("ok");
  });
});

describe("GET /api/health — external check caching & parallelization (#1337)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthCacheForTests();
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetHealthCacheForTests();
  });

  it("caches external Soroban RPC and Horizon check results across repeat invocations", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchSpy as unknown as typeof fetch;

    // First call: executes external pings
    const res1 = await getHealth(new Request("http://localhost/api/health"));
    expect(res1.status).toBe(200);
    const callCountAfterFirst = fetchSpy.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);

    // Second call immediately within TTL: hits cache, does not issue new external fetch calls
    const res2 = await getHealth(new Request("http://localhost/api/health"));
    expect(res2.status).toBe(200);
    expect(fetchSpy.mock.calls.length).toBe(callCountAfterFirst);

    // Clear cache and call again: triggers new external checks
    resetHealthCacheForTests();
    const res3 = await getHealth(new Request("http://localhost/api/health"));
    expect(res3.status).toBe(200);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
  });
});
