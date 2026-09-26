import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock contracts
vi.mock("@/lib/contracts", () => {
  let mockId = "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";
  return {
    get OPHIRPAY_CONTRACT_ID() {
      return mockId;
    },
    setMockContractId: (id: string) => {
      mockId = id;
    },
  };
});

import prisma from "@/lib/prisma";
import { GET } from "@/app/api/health/route";
import * as contracts from "@/lib/contracts";

const originalFetch = global.fetch;

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Reset contract ID to valid string
    (contracts as unknown as { setMockContractId: (id: string) => void }).setMockContractId("CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns status ok when all checks pass", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.services.database.status).toBe("ok");
    expect(body.data.services.stellar.rpc.status).toBe("ok");
    expect(body.data.services.stellar.horizon.status).toBe("ok");
    expect(body.data.services.contract.status).toBe("ok");
  });

  it("returns degraded when only optional checks fail", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    // Fetch fails
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200); // degraded is still 200

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("degraded");
    expect(body.data.services.database.status).toBe("ok");
    expect(body.data.services.stellar.rpc.status).toBe("error");
    expect(body.data.services.stellar.horizon.status).toBe("error");
    expect(body.data.services.contract.status).toBe("ok");
  });

  it("returns error when database check fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("DB Down"));
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("error");
    expect(body.data.services.database.status).toBe("error");
    // Contract is ok, but overall is error because DB is down
    expect(body.data.services.contract.status).toBe("ok");
  });

  it("returns degraded when contract id is invalid", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);
    (contracts as unknown as { setMockContractId: (id: string) => void }).setMockContractId("INVALID_ID");

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("degraded");
    expect(body.data.services.contract.status).toBe("error");
    expect(body.data.services.database.status).toBe("ok");
  });

  describe("Liveness vs Readiness Probes (#738)", () => {
    it("returns liveness status 200 without querying database or external services", async () => {
      // Even if database query would fail, liveness must succeed to avoid container restart loops
      vi.mocked(prisma.$queryRaw).mockImplementation(() => {
        throw new Error("DB Down");
      });

      const res = await GET(new Request("http://localhost/api/health?probe=liveness"));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("ok");
      expect(body.data.probe).toBe("liveness");
      expect(typeof body.data.uptime).toBe("number");
      // Assert DB was never queried
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("accepts probe=readiness explicitly and reports full service statuses", async () => {
      vi.mocked(prisma.$queryRaw).mockReset();
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const res = await GET(new Request("http://localhost/api/health?probe=readiness"));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("ok");
      expect(body.data.probe).toBe("readiness");
      expect(body.data.services.database.status).toBe("ok");
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("dedicated /api/health/liveness endpoint returns liveness status", async () => {
      const { GET: livenessRouteGet } = await import("@/app/api/health/liveness/route");
      const res = await livenessRouteGet();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("ok");
      expect(body.data.probe).toBe("liveness");
      expect(typeof body.data.uptime).toBe("number");
    });

    it("dedicated /api/health/readiness endpoint delegates to full readiness check", async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const { GET: readinessRouteGet } = await import("@/app/api/health/readiness/route");
      const res = await readinessRouteGet(new Request("http://localhost/api/health/readiness"));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.probe).toBe("readiness");
      expect(body.data.services.database.status).toBe("ok");
    });
  });
});
