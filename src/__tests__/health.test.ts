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
import { GET, resetHealthChecksCache } from "@/app/api/health/route";
import * as contracts from "@/lib/contracts";

const originalFetch = global.fetch;

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthChecksCache();
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

  it("returns package version and commit SHA from environment", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const prevGitSha = process.env.GIT_SHA;
    process.env.GIT_SHA = "f93ff410f58ba262fa6d51de6cf300ec8a8cffee";
    try {
      const res = await GET(new Request("http://localhost/api/health"));
      const body = await res.json();
      expect(body.data.version).toBe("0.1.0");
      expect(body.data.commit).toBe("f93ff41");
    } finally {
      if (prevGitSha !== undefined) {
        process.env.GIT_SHA = prevGitSha;
      } else {
        delete process.env.GIT_SHA;
      }
    }
  });
});
