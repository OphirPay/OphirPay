// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ioredis
const mockPing = vi.fn();
const mockConnect = vi.fn();
const mockQuit = vi.fn();
const mockDisconnect = vi.fn();

vi.mock("ioredis", () => {
  return {
    Redis: class {
      connect = mockConnect;
      ping = mockPing;
      quit = mockQuit;
      disconnect = mockDisconnect;
    },
  };
});

// Mock prisma for health endpoint
vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}));

// Mock contracts for health endpoint
vi.mock("@/lib/contracts", () => ({
  OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
}));

import { checkRedisHealth } from "@/lib/redis-health";
import { GET } from "@/app/api/health/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe("Redis Health Check (Issue #1338)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.REDIS_TOKEN;
    delete process.env.REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    mockConnect.mockResolvedValue(undefined);
    mockPing.mockResolvedValue("PONG");
    mockQuit.mockResolvedValue("OK");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  describe("checkRedisHealth unit tests", () => {
    it("reports disabled when no Redis environment variables are set", async () => {
      const result = await checkRedisHealth();
      expect(result.status).toBe("disabled");
      expect(result.latencyMs).toBeNull();
    });

    it("reports ok for TCP redis:// URL when connection and ping succeed", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:6379";

      const result = await checkRedisHealth();
      expect(result.status).toBe("ok");
      expect(typeof result.latencyMs).toBe("number");
      expect(mockConnect).toHaveBeenCalled();
      expect(mockPing).toHaveBeenCalled();
      expect(mockQuit).toHaveBeenCalled();
    });

    it("reports error for TCP redis:// URL when ping fails or connection throws", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:6379";
      mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await checkRedisHealth();
      expect(result.status).toBe("error");
      expect(result.latencyMs).toBeNull();
    });

    it("reports ok for Upstash https:// URL and attaches Bearer token", async () => {
      process.env.REDIS_REST_URL = "https://upstash-test.upstash.io";
      process.env.REDIS_REST_TOKEN = "upstash_secret_token";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: "PONG" }),
      } as Response);

      const result = await checkRedisHealth(3000, mockFetch as unknown as typeof fetch);
      expect(result.status).toBe("ok");
      expect(typeof result.latencyMs).toBe("number");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://upstash-test.upstash.io/ping",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer upstash_secret_token",
          }),
        })
      );
    });

    it("reports error for Upstash https:// URL when REST endpoint returns HTTP error", async () => {
      process.env.REDIS_URL = "https://upstash-test.upstash.io";
      process.env.REDIS_TOKEN = "invalid_token";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const result = await checkRedisHealth(3000, mockFetch as unknown as typeof fetch);
      expect(result.status).toBe("error");
      expect(result.latencyMs).toBeNull();
    });

    it("reports error for Upstash https:// URL when fetch throws a network error", async () => {
      process.env.REDIS_URL = "https://upstash-test.upstash.io";

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

      const result = await checkRedisHealth(3000, mockFetch as unknown as typeof fetch);
      expect(result.status).toBe("error");
      expect(result.latencyMs).toBeNull();
    });
  });

  describe("GET /api/health integration with Redis", () => {
    it("reports redis.status: 'ok' in health response when TCP redis:// is active", async () => {
      process.env.REDIS_URL = "redis://redis:6379";

      // Mock other HTTP checks in health route (Soroban RPC, Horizon)
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("ok");
      expect(body.data.services.redis.status).toBe("ok");
      expect(typeof body.data.services.redis.latencyMs).toBe("number");
    });

    it("reports redis.status: 'ok' in health response when Upstash URL is active", async () => {
      process.env.UPSTASH_REDIS_REST_URL = "https://my-upstash.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "token_xyz";

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        return Promise.resolve({ ok: true, status: 200 } as Response);
      });

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("ok");
      expect(body.data.services.redis.status).toBe("ok");
    });

    it("reports degraded status when Redis check fails", async () => {
      process.env.REDIS_URL = "redis://unreachable:6379";
      mockConnect.mockRejectedValueOnce(new Error("Connection refused"));

      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

      const res = await GET();
      expect(res.status).toBe(200); // Degraded still returns 200

      const body = await res.json();
      expect(body.data.status).toBe("degraded");
      expect(body.data.services.redis.status).toBe("error");
    });
  });
});
