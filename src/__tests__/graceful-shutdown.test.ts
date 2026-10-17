// SPDX-License-Identifier: MIT
/**
 * Issue #1311 — Implement graceful connection teardown and SIGTERM signal
 * handlers for Prisma and Redis.
 *
 * Verifies:
 *   • `SIGTERM` and `SIGINT` trigger clean disconnection of Prisma
 *     (`await prisma.$disconnect()`) and Redis (`await redis.quit()`) clients.
 *   • In-flight database/background operations tracked via
 *     `trackInFlightOperation()` complete within the grace period before
 *     connections are closed.
 *   • New background operations are rejected with `ShutdownInProgressError`
 *     once shutdown has begun.
 *   • Hung operations exceeding the grace period time out and allow teardown
 *     to proceed without hanging indefinitely.
 *   • Structured logs are emitted at shutdown start and completion.
 *   • `next dev` hot-reload (`NODE_ENV === "development"`) skips attaching
 *     process signal listeners unless `forceInDev: true`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    request: vi.fn(),
  },
}));

import { logger } from "@/lib/logger";
import {
  DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
  ShutdownInProgressError,
  getInFlightOperationCount,
  initiateGracefulShutdown,
  isShuttingDown,
  registerPrismaClient,
  registerRedisClient,
  registerShutdownHandlers,
  resetLifecycleStateForTests,
  trackInFlightOperation,
} from "@/lib/lifecycle";
import {
  disconnectRedisClients,
  getRegisteredRedisClientCount,
} from "@/lib/redis";

class FakeProcess extends EventEmitter {
  public env: NodeJS.ProcessEnv;
  constructor(nodeEnv = "production") {
    super();
    this.env = { NODE_ENV: nodeEnv };
  }
}

describe("Graceful Shutdown & Connection Lifecycle (issue #1311)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLifecycleStateForTests();
  });

  afterEach(() => {
    resetLifecycleStateForTests();
  });

  it("disconnects registered Prisma and Redis clients on SIGTERM and emits structured logs", async () => {
    const events: string[] = [];
    const prismaMock = {
      $disconnect: vi.fn(async () => {
        events.push("prisma.$disconnect");
      }),
    };
    const redisMock = {
      quit: vi.fn(async () => {
        events.push("redis.quit");
        return "OK";
      }),
    };

    registerPrismaClient(prismaMock);
    registerRedisClient(redisMock);
    expect(getRegisteredRedisClientCount()).toBe(1);

    const summary = await initiateGracefulShutdown("SIGTERM", {
      gracePeriodMs: 1_000,
    });

    expect(summary.signal).toBe("SIGTERM");
    expect(summary.drainedCleanly).toBe(true);
    expect(summary.prismaDisconnected).toBe(1);
    expect(summary.redisDisconnected).toBe(1);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
    expect(redisMock.quit).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["prisma.$disconnect", "redis.quit"]);

    expect(logger.info).toHaveBeenCalledWith(
      "Graceful shutdown initiated",
      expect.objectContaining({
        signal: "SIGTERM",
        inFlightCount: 0,
        gracePeriodMs: 1_000,
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Graceful shutdown completed",
      expect.objectContaining({
        signal: "SIGTERM",
        drainedCleanly: true,
        prismaDisconnected: 1,
        redisDisconnected: 1,
      })
    );
  });

  it("waits for in-flight database operations to finish before disconnecting Prisma and Redis", async () => {
    const timeline: string[] = [];
    let resolveQuery!: (val: string) => void;

    const queryPromise = trackInFlightOperation(
      () =>
        new Promise<string>((resolve) => {
          timeline.push("query:start");
          resolveQuery = (v: string) => {
            timeline.push("query:end");
            resolve(v);
          };
        }),
      { label: "payment.mutation" }
    );

    expect(getInFlightOperationCount()).toBe(1);

    const prismaMock = {
      $disconnect: vi.fn(async () => {
        timeline.push("prisma:$disconnect");
      }),
    };
    const redisMock = {
      quit: vi.fn(async () => {
        timeline.push("redis:quit");
        return "OK";
      }),
    };
    registerPrismaClient(prismaMock);
    registerRedisClient(redisMock);

    // Initiate shutdown while the query is still in flight
    const shutdownPromise = initiateGracefulShutdown("SIGINT", {
      gracePeriodMs: DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
    });

    expect(isShuttingDown()).toBe(true);
    // Reject any newly submitted background operations during shutdown
    await expect(
      trackInFlightOperation(async () => "should-not-run", {
        label: "new.job",
      })
    ).rejects.toBeInstanceOf(ShutdownInProgressError);

    // Complete the in-flight query
    resolveQuery("committed");
    await expect(queryPromise).resolves.toBe("committed");

    const summary = await shutdownPromise;
    expect(summary.drainedCleanly).toBe(true);
    expect(summary.remainingInFlight).toBe(0);
    expect(timeline).toEqual([
      "query:start",
      "query:end",
      "prisma:$disconnect",
      "redis:quit",
    ]);
  });

  it("enforces the grace period timeout when an operation hangs and still disconnects clients", async () => {
    const prismaMock = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    const redisMock = { quit: vi.fn().mockResolvedValue("OK") };
    registerPrismaClient(prismaMock);
    registerRedisClient(redisMock);

    // Start a never-resolving operation
    void trackInFlightOperation(() => new Promise(() => {}), {
      label: "hung.query",
    });

    const summary = await initiateGracefulShutdown("SIGTERM", {
      gracePeriodMs: 40,
    });

    expect(summary.drainedCleanly).toBe(false);
    expect(summary.remainingInFlight).toBe(1);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
    expect(redisMock.quit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Graceful shutdown drain window expired with operations still in flight",
      expect.objectContaining({
        signal: "SIGTERM",
        remainingInFlight: 1,
        gracePeriodMs: 40,
      })
    );
  });

  it("registers SIGTERM and SIGINT listeners in production and skips duplicate registration in development (next dev)", async () => {
    const devProc = new FakeProcess("development");
    const unregisterDev = registerShutdownHandlers({
      processTarget: devProc as unknown as NodeJS.Process,
    });
    expect(devProc.listenerCount("SIGTERM")).toBe(0);
    expect(devProc.listenerCount("SIGINT")).toBe(0);
    unregisterDev();

    const prodProc = new FakeProcess("production");
    const prismaMock = { $disconnect: vi.fn().mockResolvedValue(undefined) };
    registerPrismaClient(prismaMock);

    const unregisterProd = registerShutdownHandlers({
      processTarget: prodProc as unknown as NodeJS.Process,
      gracePeriodMs: 200,
    });
    // Calling registerShutdownHandlers a second time is idempotent
    registerShutdownHandlers({
      processTarget: prodProc as unknown as NodeJS.Process,
    });
    expect(prodProc.listenerCount("SIGTERM")).toBe(1);
    expect(prodProc.listenerCount("SIGINT")).toBe(1);

    prodProc.emit("SIGTERM");
    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);

    unregisterProd();
    expect(prodProc.listenerCount("SIGTERM")).toBe(0);
    expect(prodProc.listenerCount("SIGINT")).toBe(0);
  });

  it("falls back to redis.disconnect() if redis.quit() throws", async () => {
    const disconnectSpy = vi.fn();
    registerRedisClient({
      quit: vi.fn().mockRejectedValue(new Error("Connection closed")),
      disconnect: disconnectSpy,
    });

    await disconnectRedisClients();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
