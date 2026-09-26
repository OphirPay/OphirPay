// SPDX-License-Identifier: MIT
//
// Tests for the pluggable rate-limit backend selection (issue #703).
//
// The bug: the global limiter in src/proxy.ts constructed its own in-memory
// store on the Edge runtime, so REDIS_URL documented in .env.example had no
// effect and limits were multiplied by the replica count. These tests prove
// the new behaviour:
//
//   • an HTTP/REST Redis endpoint is honoured on any runtime,
//   • two independent store instances share one bucket through it
//     ("two simulated instances"),
//   • with no Redis configured the semantics are the in-memory ones.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Deterministic stand-in for the optional `ioredis` dependency. The class
// throws from its constructor so `initRateLimitStore()` must fall back to the
// in-memory store instead of leaving the app without a limiter. Only the
// `redis://` branch of initRateLimitStore ever imports this module.
vi.mock("ioredis", () => ({
  Redis: class {
    constructor() {
      throw new Error("ioredis unavailable in this environment");
    }
  },
}));

import {
  HttpRedisRateLimitStore,
  InMemoryRateLimitStore,
  createRateLimitStoreFromEnv,
  getRateLimitStore,
  getRedisRestConfig,
  initRateLimitStore,
  isHttpRedisUrl,
  setRateLimitStore,
} from "@/lib/rate-limit";

// ── Minimal fake Redis REST backend ─────────────────────────────
//
// Speaks the Upstash REST protocol (`POST` a JSON command array, receive
// `{ result }`) backed by a shared Map, so two stores pointed at the same
// "server" observe the same counters.

function makeFakeRedis() {
  const counters = new Map<string, number>();
  const expires = new Map<string, number>();

  const fetchImpl = vi.fn(
    async (_url: string, init: RequestInit): Promise<Response> => {
      const command = JSON.parse(String(init?.body)) as (string | number)[];
      const [op, key, arg] = command as [string, string, number];

      let result: number | null = null;
      if (op === "INCR") {
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        result = next;
      } else if (op === "EXPIRE") {
        expires.set(key, Number(arg));
        result = 1;
      } else if (op === "DEL") {
        counters.delete(key);
        expires.delete(key);
        result = 1;
      } else {
        return new Response(JSON.stringify({ error: `unknown command ${op}` }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({ result }), { status: 200 });
    }
  );

  return { fetchImpl, counters, expires };
}

const originalRedisUrl = process.env.REDIS_URL;

beforeEach(() => {
  setRateLimitStore(new InMemoryRateLimitStore());
  delete process.env.REDIS_URL;
  delete process.env.REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.REDIS_TOKEN;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

// ── HttpRedisRateLimitStore ─────────────────────────────────────

describe("HttpRedisRateLimitStore", () => {
  it("increments via the REST INCR command and sets a TTL on the first hit", async () => {
    const { fetchImpl, expires } = makeFakeRedis();
    const store = new HttpRedisRateLimitStore({
      url: "https://redis.example.com/",
      token: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await store.increment("ip-1", 60_000, 5);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(4);

    const second = await store.increment("ip-1", 60_000, 5);
    expect(second.remaining).toBe(3);

    // EXPIRE is only issued when the counter is created, and the trailing
    // slash on the URL is normalised away.
    expect(expires.get("ip-1")).toBe(60);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://redis.example.com");

    const auth = (fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>)
      .Authorization;
    expect(auth).toBe("Bearer tok");
  });

  it("blocks once the shared counter exceeds the limit", async () => {
    const { fetchImpl } = makeFakeRedis();
    const store = new HttpRedisRateLimitStore({
      url: "https://redis.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    for (let i = 0; i < 3; i++) {
      expect((await store.increment("ip", 60_000, 2)).allowed).toBe(i < 2);
    }
  });

  it("resets a bucket with DEL", async () => {
    const { fetchImpl, counters } = makeFakeRedis();
    const store = new HttpRedisRateLimitStore({
      url: "https://redis.example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await store.increment("ip", 60_000, 5);
    await store.reset("ip");
    expect(counters.has("ip")).toBe(false);

    const after = await store.increment("ip", 60_000, 5);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(4);
  });

  it("throws when the REST endpoint returns a non-2xx status", async () => {
    const store = new HttpRedisRateLimitStore({
      url: "https://redis.example.com",
      fetchImpl: vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(store.increment("ip", 60_000, 5)).rejects.toThrow(/HTTP 500/);
  });

  it("throws when the REST payload carries an error", async () => {
    const store = new HttpRedisRateLimitStore({
      url: "https://redis.example.com",
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify({ error: "ERR broken" }), { status: 200 })
      ) as unknown as typeof fetch,
    });
    await expect(store.increment("ip", 60_000, 5)).rejects.toThrow(/ERR broken/);
  });
});

// ── Shared state across instances (acceptance criterion) ────────

describe("distributed semantics", () => {
  it("two simulated instances share one bucket through the REST backend", async () => {
    const { fetchImpl } = makeFakeRedis();
    const shared = fetchImpl as unknown as typeof fetch;

    // Two independent processes — same Redis, same bucket.
    const instanceA = new HttpRedisRateLimitStore({ url: "https://redis.example.com", fetchImpl: shared });
    const instanceB = new HttpRedisRateLimitStore({ url: "https://redis.example.com", fetchImpl: shared });

    expect((await instanceA.increment("203.0.113.9", 60_000, 3)).remaining).toBe(2);
    expect((await instanceB.increment("203.0.113.9", 60_000, 3)).remaining).toBe(1);
    expect((await instanceB.increment("203.0.113.9", 60_000, 3)).remaining).toBe(0);
    // The fourth request from *either* replica is rejected — the limit is global.
    expect((await instanceA.increment("203.0.113.9", 60_000, 3)).allowed).toBe(false);
  });
});

// ── Backend selection ───────────────────────────────────────────

describe("createRateLimitStoreFromEnv", () => {
  it("returns the in-memory store when no Redis is configured (today's semantics)", async () => {
    const store = createRateLimitStoreFromEnv();
    expect(store).toBeInstanceOf(InMemoryRateLimitStore);

    // Same behaviour as before: per-key windows, isolated buckets.
    const first = await store.increment("ip", 60_000, 1);
    expect(first.allowed).toBe(true);
    expect((await store.increment("ip", 60_000, 1)).allowed).toBe(false);
    expect((await store.increment("other", 60_000, 1)).allowed).toBe(true);
  });

  it("returns a REST-backed store when REDIS_URL is an http(s) endpoint", () => {
    vi.stubEnv("REDIS_URL", "https://redis.example.com");
    vi.stubEnv("REDIS_TOKEN", "secret");
    expect(createRateLimitStoreFromEnv()).toBeInstanceOf(HttpRedisRateLimitStore);
    expect(getRedisRestConfig()).toEqual({
      url: "https://redis.example.com",
      token: "secret",
    });
  });

  it("prefers REDIS_REST_URL over an https REDIS_URL", () => {
    vi.stubEnv("REDIS_URL", "https://fallback.example.com");
    vi.stubEnv("REDIS_REST_URL", "https://preferred.example.com");
    expect(getRedisRestConfig()?.url).toBe("https://preferred.example.com");
  });

  it("ignores a redis:// REDIS_URL for the edge-safe factory", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    expect(getRedisRestConfig()).toBeNull();
    expect(createRateLimitStoreFromEnv()).toBeInstanceOf(InMemoryRateLimitStore);
  });

  it("recognises only http(s) URLs as REST endpoints", () => {
    expect(isHttpRedisUrl("https://x")).toBe(true);
    expect(isHttpRedisUrl("http://x")).toBe(true);
    expect(isHttpRedisUrl("redis://x")).toBe(false);
    expect(isHttpRedisUrl("rediss://x")).toBe(false);
    expect(isHttpRedisUrl(undefined)).toBe(false);
  });
});

// ── initRateLimitStore ──────────────────────────────────────────

describe("initRateLimitStore", () => {
  it("selects the REST backend for an http(s) REDIS_URL", async () => {
    vi.stubEnv("REDIS_URL", "https://redis.example.com");
    vi.stubEnv("REDIS_TOKEN", "tok");
    await initRateLimitStore();
    expect(getRateLimitStore()).toBeInstanceOf(HttpRedisRateLimitStore);
  });

  it("falls back to in-memory when nothing is configured", async () => {
    await initRateLimitStore();
    expect(getRateLimitStore()).toBeInstanceOf(InMemoryRateLimitStore);
  });

  it("falls back to in-memory when a redis:// connection cannot be established", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6399");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await initRateLimitStore();
    expect(getRateLimitStore()).toBeInstanceOf(InMemoryRateLimitStore);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
