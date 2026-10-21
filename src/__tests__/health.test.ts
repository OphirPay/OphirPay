import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redisClientMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  ping: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
}));

vi.mock("ioredis", () => ({
  Redis: class {
    on = redisClientMocks.on;
    connect = redisClientMocks.connect;
    ping = redisClientMocks.ping;
    disconnect = redisClientMocks.disconnect;
  },
}));

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
const redisEnvironmentKeys = [
  "REDIS_URL",
  "REDIS_TOKEN",
  "REDIS_REST_URL",
  "REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;
let savedRedisEnvironment: Partial<Record<(typeof redisEnvironmentKeys)[number], string>>;

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savedRedisEnvironment = Object.fromEntries(
      redisEnvironmentKeys.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]!]]
      )
    );
    redisEnvironmentKeys.forEach((key) => delete process.env[key]);
    redisClientMocks.connect.mockResolvedValue(undefined);
    redisClientMocks.ping.mockResolvedValue("PONG");
    global.fetch = vi.fn();
    // Reset contract ID to valid string
    (contracts as unknown as { setMockContractId: (id: string) => void }).setMockContractId("CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    redisEnvironmentKeys.forEach((key) => {
      const value = savedRedisEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
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

  it("reports a reachable TCP Redis server as healthy", async () => {
    process.env.REDIS_URL = "redis://redis:6379";
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const response = await GET(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(body.data.services.redis.status).toBe("ok");
    expect(redisClientMocks.ping).toHaveBeenCalledOnce();
    expect(redisClientMocks.disconnect).toHaveBeenCalledOnce();
  });

  it("sends authenticated PING commands to an Upstash REST endpoint", async () => {
    process.env.REDIS_URL = "https://redis.example.com";
    process.env.REDIS_TOKEN = "test-token";
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: "PONG" }),
    } as unknown as Response);

    const response = await GET(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(body.data.services.redis.status).toBe("ok");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://redis.example.com",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        body: '["PING"]',
      })
    );
  });

  it("reports an unreachable TCP Redis server as an error", async () => {
    process.env.REDIS_URL = "redis://redis:6379";
    redisClientMocks.ping.mockRejectedValueOnce(new Error("Redis unavailable"));
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }]);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const response = await GET(new Request("http://localhost/api/health"));
    const body = await response.json();

    expect(body.data.services.redis.status).toBe("error");
  });

  it("answers the lightweight ?probe=rpc branch without touching the DB", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);

    const res = await GET(new Request("http://localhost/api/health?probe=rpc"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.services.stellar.rpc.status).toBe("ok");
    expect(body.data.services.database).toBeUndefined();
    expect(body.data.rpcFailover.primaryProviderName).toBe(
      "soroban-testnet.stellar.org"
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("reports a degraded RPC in the ?probe=rpc branch as a 200 body", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("RPC down"));

    const res = await GET(new Request("http://localhost/api/health?probe=rpc"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.status).toBe("degraded");
    expect(body.data.services.stellar.rpc.status).toBe("error");
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
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
