// SPDX-License-Identifier: MIT

/**
 * Redis client abstraction for server-side caching and atomic locks (#1366).
 *
 * Supports:
 * - TCP Redis via `ioredis` (`redis://` or `rediss://` in `REDIS_URL`)
 * - HTTP/REST Redis (`https://` in `REDIS_URL` / `REDIS_REST_URL` / `UPSTASH_REDIS_REST_URL`)
 * - Injectable `RedisClient` (such as `InMemoryRedisClient` in tests)
 * - Graceful `null` fallback when Redis is unconfigured or unreachable so
 *   callers can fall back to database uniqueness constraints.
 */

import { logger } from "@/lib/logger";

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  ttl?(key: string): Promise<number>;
}

interface InMemoryEntry {
  value: string;
  expiresAt: number | null;
}

/**
 * In-memory Redis-compatible client with atomic `SET NX EX` semantics and
 * lazy + active TTL expiration cleanup. Useful for unit tests and local
 * single-process environments.
 */
export class InMemoryRedisClient implements RedisClient {
  private readonly store = new Map<string, InMemoryEntry>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Remove all expired keys and return the number of evicted entries. */
  cleanupExpired(): number {
    const current = this.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && entry.expiresAt <= current) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private getLiveEntry(key: string): InMemoryEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.getLiveEntry(key);
    return entry ? entry.value : null;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<string | null> {
    let nx = false;
    let xx = false;
    let expiresAt: number | null = null;

    for (let i = 0; i < args.length; i++) {
      const token = String(args[i]).toUpperCase();
      if (token === "NX") {
        nx = true;
      } else if (token === "XX") {
        xx = true;
      } else if (token === "EX") {
        const seconds = Number(args[i + 1]);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          throw new Error(`Invalid EX TTL seconds: ${String(args[i + 1])}`);
        }
        expiresAt = this.now() + seconds * 1000;
        i++;
      } else if (token === "PX") {
        const ms = Number(args[i + 1]);
        if (!Number.isFinite(ms) || ms <= 0) {
          throw new Error(`Invalid PX TTL ms: ${String(args[i + 1])}`);
        }
        expiresAt = this.now() + ms;
        i++;
      }
    }

    const existing = this.getLiveEntry(key);
    if (nx && existing !== null) {
      return null;
    }
    if (xx && existing === null) {
      return null;
    }

    this.store.set(key, { value, expiresAt });

    if (this.store.size > 5_000) {
      this.cleanupExpired();
    }

    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.getLiveEntry(key) !== null;
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.getLiveEntry(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - this.now()) / 1000));
  }

  /** Number of currently active (non-expired) keys. */
  size(): number {
    this.cleanupExpired();
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * HTTP/REST Redis client compatible with Upstash REST protocol.
 */
export class HttpRedisClient implements RedisClient {
  private readonly url: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { url: string; token?: string; fetchImpl?: typeof fetch }) {
    this.url = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async command(cmd: Array<string | number>): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(cmd),
    });

    if (!response.ok) {
      throw new Error(`Redis REST command failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: unknown;
      error?: string;
    };
    if (payload.error) {
      throw new Error(`Redis REST error: ${payload.error}`);
    }
    return payload.result;
  }

  async get(key: string): Promise<string | null> {
    const res = await this.command(["GET", key]);
    return typeof res === "string" ? res : null;
  }

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<string | null> {
    const res = await this.command(["SET", key, value, ...args]);
    return typeof res === "string" ? res : null;
  }

  async del(key: string): Promise<number> {
    const res = await this.command(["DEL", key]);
    return Number(res ?? 0);
  }

  async ttl(key: string): Promise<number> {
    const res = await this.command(["TTL", key]);
    return Number(res ?? -2);
  }
}

const HTTP_REDIS_URL = /^https?:\/\//i;
const TCP_REDIS_URL = /^rediss?:\/\//i;

let _overrideClient: RedisClient | null | undefined = undefined;
let _envClient: RedisClient | null = null;
let _envClientUrl: string | undefined = undefined;

/**
 * Inject a custom Redis client (or `null` to simulate Redis unavailability) in tests.
 */
export function setRedisClient(client: RedisClient | null): void {
  _overrideClient = client;
}

/**
 * Reset any injected or cached Redis client singleton.
 */
export function resetRedisClient(): void {
  _overrideClient = undefined;
  _envClient = null;
  _envClientUrl = undefined;
}

/**
 * Resolve a Redis client from the current configuration, or return `null` when
 * Redis is not configured or cannot be reached.
 */
export async function getRedisClient(): Promise<RedisClient | null> {
  if (_overrideClient !== undefined) {
    return _overrideClient;
  }

  const restUrl =
    process.env.REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    (process.env.REDIS_URL && HTTP_REDIS_URL.test(process.env.REDIS_URL)
      ? process.env.REDIS_URL
      : undefined);

  if (restUrl) {
    if (_envClient && _envClientUrl === restUrl) {
      return _envClient;
    }
    const token =
      process.env.REDIS_REST_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      process.env.REDIS_TOKEN;
    _envClient = new HttpRedisClient({ url: restUrl, token });
    _envClientUrl = restUrl;
    return _envClient;
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl && TCP_REDIS_URL.test(redisUrl)) {
    if (_envClient && _envClientUrl === redisUrl) {
      return _envClient;
    }
    try {
      const RedisModule = await import("ioredis");
      const ioredis = new RedisModule.Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await ioredis.connect();
      const adapter: RedisClient = {
        get: (key: string) => ioredis.get(key),
        set: (key: string, value: string, ...args: Array<string | number>) =>
          (
            ioredis.set as unknown as (
              k: string,
              v: string,
              ...rest: Array<string | number>
            ) => Promise<string | null>
          )(key, value, ...args),
        del: (key: string) => ioredis.del(key),
        ttl: (key: string) => ioredis.ttl(key),
      };
      _envClient = adapter;
      _envClientUrl = redisUrl;
      return _envClient;
    } catch (err) {
      logger.warn("Redis connection unavailable; falling back to database", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  return null;
}
