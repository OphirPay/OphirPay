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

let mockIoredisPingFail = false;
let mockIoredisConnectFail = false;
let mockIoredisPingCalls = 0;

vi.mock("ioredis", () => {
  class MockRedis {
    status = "ready";
    connect = vi.fn().mockImplementation(async () => {
      if (mockIoredisConnectFail) {
        throw new Error("Connection refused");
      }
    });
    ping = vi.fn().mockImplementation(async () => {
      mockIoredisPingCalls++;
      if (mockIoredisPingFail) {
        throw new Error("Redis timeout");
      }
      return "PONG";
    });
    disconnect = vi.fn().mockImplementation(() => {
      this.status = "end";
    });
    on = vi.fn();
  }

  return {
    default: MockRedis,
    Redis: MockRedis,
  };
});

import prisma from "@/lib/prisma";
import { GET, resetRedisClientForTests } from "@/app/api/health/route";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnv() {
  delete process.env.REDIS_URL;
  delete process.env.REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.REDIS_TOKEN;
}

describe("GET /api/health — Redis probe (#1338)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv();
    resetRedisClientForTests();
    mockIoredisPingFail = false;
    mockIoredisConnectFail = false;
    mockIoredisPingCalls = 0;
    global.fetch = vi.fn();
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv();
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      }
    }
    resetRedisClientForTests();
  });

  it("reports disabled when no Redis is configured", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("disabled");
    expect(body.data.services.redis.latencyMs).toBeNull();
    expect(body.data.status).toBe("ok");
  });

  it("reports ok for a working redis:// TCP Redis", async () => {
    process.env.REDIS_URL = "redis://redis:6379";
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("ok");
    expect(typeof body.data.services.redis.latencyMs).toBe("number");
    expect(body.data.status).toBe("ok");
    expect(mockIoredisPingCalls).toBe(1);
  });

  it("reports ok for a working Upstash HTTPS URL with token header", async () => {
    process.env.REDIS_URL = "https://eu1-active-redis.upstash.io";
    process.env.REDIS_TOKEN = "upstash-secret-token";

    let capturedHeaders: HeadersInit | undefined;
    let capturedUrl: string | undefined;

    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes("upstash.io")) {
        capturedUrl = urlStr;
        capturedHeaders = init?.headers;
        return { ok: true, status: 200 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("ok");
    expect(typeof body.data.services.redis.latencyMs).toBe("number");
    expect(body.data.status).toBe("ok");

    expect(capturedUrl).toBe("https://eu1-active-redis.upstash.io/ping");
    expect(capturedHeaders).toEqual(
      expect.objectContaining({
        Authorization: "Bearer upstash-secret-token",
      })
    );
  });

  it("reports ok for Upstash credentials embedded in the URL", async () => {
    process.env.REDIS_URL = "https://default:embedded-tok@eu1-active-redis.upstash.io";

    let capturedHeaders: HeadersInit | undefined;
    let capturedUrl: string | undefined;

    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const urlStr = String(input);
      if (urlStr.includes("upstash.io")) {
        capturedUrl = urlStr;
        capturedHeaders = init?.headers;
        return { ok: true, status: 200 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("ok");
    expect(capturedUrl).toBe("https://eu1-active-redis.upstash.io/ping");
    expect(capturedHeaders).toEqual(
      expect.objectContaining({
        Authorization: "Bearer embedded-tok",
      })
    );
  });

  it("reports error and degraded overall status when TCP Redis connection fails", async () => {
    process.env.REDIS_URL = "redis://broken-redis:6379";
    mockIoredisConnectFail = true;
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200); // optional failure degrades, does not 503
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("error");
    expect(body.data.status).toBe("degraded");
  });

  it("reports error and degraded overall status when TCP Redis ping times out", async () => {
    process.env.REDIS_URL = "redis://timeout-redis:6379";
    mockIoredisPingFail = true;
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("error");
    expect(body.data.status).toBe("degraded");
  });

  it("reports error when Upstash returns 401 unauthorized", async () => {
    process.env.REDIS_URL = "https://eu1-active-redis.upstash.io";
    process.env.REDIS_TOKEN = "bad-token";

    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const urlStr = String(input);
      if (urlStr.includes("upstash.io")) {
        return { ok: false, status: 401 } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("error");
    expect(body.data.status).toBe("degraded");
  });

  it("reports error when an unrecognised REDIS_URL scheme is supplied", async () => {
    process.env.REDIS_URL = "ftp://invalid-redis-scheme";
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("error");
    expect(body.data.status).toBe("degraded");
  });
});
