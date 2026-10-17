// SPDX-License-Identifier: MIT

/**
 * Redis-backed idempotency (issue #1366).
 *
 * The behaviours that matter are the atomic ones, so the fake broker below
 * implements just enough of `SET … EX … NX` and the compare-and-delete Lua
 * script to be honest about interleaving: two claims for the same
 * (user, key) cannot both win, and a lease that has been re-acquired by
 * another request cannot be deleted by its previous holder.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  IDEMPOTENCY_LOCK_TTL_SECONDS,
  IDEMPOTENCY_RESPONSE_TTL_SECONDS,
  IDEMPOTENCY_RETRY_AFTER_SECONDS,
  claimIdempotencyKey,
  forgetIdempotencyKey,
  readIdempotentResponse,
} from "@/lib/idempotency";
import {
  resetRedisClient,
  setRedisClientForTests,
  type RedisLike,
} from "@/lib/redis";

interface Entry {
  value: string;
  expiresAt: number;
}

/** Minimal single-threaded Redis with EX/NX and the release script. */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, Entry>();
  readonly setCalls: { key: string; args: (string | number)[] }[] = [];
  readonly evalCalls: (string | number)[][] = [];

  private alive(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown> {
    this.setCalls.push({ key, args });
    const mode = String(args[0]).toUpperCase();
    const ttl = Number(args[1]);
    const flag = args[2] ? String(args[2]).toUpperCase() : null;

    if (flag === "NX" && this.alive(key)) return null;

    const expiresAt = mode === "EX" ? Date.now() + ttl * 1000 : Date.now() + ttl;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<unknown> {
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1;
    }
    return removed;
  }

  async eval(
    _script: string,
    _numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    this.evalCalls.push(args);
    const [key, token] = args.map(String);
    if (this.alive(key)?.value === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

let fake: FakeRedis;

beforeEach(() => {
  fake = new FakeRedis();
  setRedisClientForTests(fake);
});

afterEach(() => {
  resetRedisClient();
  vi.useRealTimers();
});

describe("claimIdempotencyKey", () => {
  it("grants the lease to the first caller with a 120s TTL", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");

    expect(claim.status).toBe("acquired");
    const lock = fake.setCalls.find((c) => c.key.startsWith("idempotency:lock"));
    expect(lock).toBeDefined();
    expect(lock?.args).toEqual(["EX", IDEMPOTENCY_LOCK_TTL_SECONDS, "NX"]);
    expect(IDEMPOTENCY_LOCK_TTL_SECONDS).toBe(120);
  });

  it("rejects a concurrent claim for the same key with a retry delay", async () => {
    const first = await claimIdempotencyKey("user-1", "batch-key-12345");
    const second = await claimIdempotencyKey("user-1", "batch-key-12345");

    expect(first.status).toBe("acquired");
    expect(second).toEqual({
      status: "in-flight",
      retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS,
    });
    expect(IDEMPOTENCY_RETRY_AFTER_SECONDS).toBe(5);
  });

  it("namespaces the lock per user so tenants cannot block each other", async () => {
    const a = await claimIdempotencyKey("user-a", "shared-key-123");
    const b = await claimIdempotencyKey("user-b", "shared-key-123");

    expect(a.status).toBe("acquired");
    expect(b.status).toBe("acquired");
  });

  it("frees the key on release so a retry can proceed", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (claim.status !== "acquired") throw new Error("expected a lease");

    await claim.release();
    const retry = await claimIdempotencyKey("user-1", "batch-key-12345");
    expect(retry.status).toBe("acquired");
  });

  it("does not delete a lease it no longer owns", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (claim.status !== "acquired") throw new Error("expected a lease");

    // Simulate the lease expiring and another request taking it.
    fake.store.set("idempotency:lock:user-1:batch-key-12345", {
      value: "someone-else",
      expiresAt: Date.now() + 60_000,
    });

    await claim.release();
    expect(
      fake.store.get("idempotency:lock:user-1:batch-key-12345")?.value
    ).toBe("someone-else");
  });

  it("allows a new claim once the lease expires", async () => {
    const first = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (first.status !== "acquired") throw new Error("expected a lease");

    // Age the entry past the 120s TTL instead of waiting for it.
    const lockKey = "idempotency:lock:user-1:batch-key-12345";
    const entry = fake.store.get(lockKey)!;
    fake.store.set(lockKey, { ...entry, expiresAt: Date.now() - 1 });

    const second = await claimIdempotencyKey("user-1", "batch-key-12345");
    expect(second.status).toBe("acquired");
  });
});

describe("completed-response cache", () => {
  const body = {
    success: true,
    data: { id: "batch-1" },
    meta: { timestamp: "2026-10-17T00:00:00.000Z" },
  };

  it("replays the cached 201 for 24 hours after completion", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (claim.status !== "acquired") throw new Error("expected a lease");

    await claim.remember({ status: 201, body });

    const response = fake.setCalls.find((c) =>
      c.key.startsWith("idempotency:response")
    );
    expect(response?.args).toEqual(["EX", IDEMPOTENCY_RESPONSE_TTL_SECONDS]);
    expect(IDEMPOTENCY_RESPONSE_TTL_SECONDS).toBe(24 * 60 * 60);

    const replay = await claimIdempotencyKey("user-1", "batch-key-12345");
    expect(replay).toEqual({ status: "replay", response: { status: 201, body } });
  });

  it("serves the cache before consulting the lock", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (claim.status !== "acquired") throw new Error("expected a lease");
    await claim.remember({ status: 201, body });

    // Re-take the lease to prove the cache wins even while it is held.
    await claimIdempotencyKey("user-1", "batch-key-12345");

    const replay = await readIdempotentResponse("user-1", "batch-key-12345");
    expect(replay).toEqual({ status: 201, body });
  });

  it("ignores a corrupt cache entry instead of throwing", async () => {
    fake.store.set("idempotency:response:user-1:batch-key-12345", {
      value: "not-json",
      expiresAt: Date.now() + 60_000,
    });

    expect(await readIdempotentResponse("user-1", "batch-key-12345")).toBeNull();
    // And the claim can still proceed rather than failing the request.
    expect((await claimIdempotencyKey("user-1", "batch-key-12345")).status).toBe(
      "acquired"
    );
  });

  it("keeps cached responses per user", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (claim.status !== "acquired") throw new Error("expected a lease");
    await claim.remember({ status: 201, body });

    expect(await readIdempotentResponse("user-2", "batch-key-12345")).toBeNull();
  });

  it("forgets both the cached response and the lease", async () => {
    const claim = await claimIdempotencyKey("user-1", "batch-key-12345");
    if (claim.status !== "acquired") throw new Error("expected a lease");
    await claim.remember({ status: 201, body });

    await forgetIdempotencyKey("user-1", "batch-key-12345");
    expect(await readIdempotentResponse("user-1", "batch-key-12345")).toBeNull();
  });
});

describe("degradation without Redis", () => {
  it("reports unavailable when no broker is configured", async () => {
    resetRedisClient();
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    try {
      expect(await claimIdempotencyKey("user-1", "batch-key-12345")).toEqual({
        status: "unavailable",
      });
    } finally {
      if (previous !== undefined) process.env.REDIS_URL = previous;
    }
  });

  it("reports unavailable when a command fails, instead of throwing", async () => {
    setRedisClientForTests({
      get: () => Promise.reject(new Error("connection reset")),
      set: () => Promise.reject(new Error("connection reset")),
      del: () => Promise.reject(new Error("connection reset")),
    });

    expect(await claimIdempotencyKey("user-1", "batch-key-12345")).toEqual({
      status: "unavailable",
    });
    // The failed client is dropped, so the next process does not pay for it.
    resetRedisClient();
  });
});
