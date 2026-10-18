// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerShutdownHook,
  clearShutdownHooks,
  resetLifecycleState,
  isShuttingDown,
  getLifecycleState,
  getShutdownTimeoutMs,
  executeGracefulShutdown,
  setupSignalHandlers,
  teardownSignalHandlers,
} from "../lib/lifecycle";
import {
  disconnectRedis,
  setRedisClientForTesting,
  hasActiveRedisClient,
  getActiveRedisClient,
  RedisClientLike,
} from "../lib/redis";
import prisma, { disconnectPrisma } from "../lib/prisma";

describe("Process Lifecycle and Graceful Teardown", () => {
  beforeEach(() => {
    clearShutdownHooks();
    resetLifecycleState();
    teardownSignalHandlers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearShutdownHooks();
    resetLifecycleState();
    teardownSignalHandlers();
  });

  describe("registerShutdownHook and execution order", () => {
    it("should execute hooks in descending order of priority", async () => {
      const callOrder: string[] = [];

      registerShutdownHook(
        "low-priority",
        async () => {
          callOrder.push("low");
        },
        1
      );

      registerShutdownHook(
        "high-priority",
        async () => {
          callOrder.push("high");
        },
        20
      );

      registerShutdownHook(
        "medium-priority",
        async () => {
          callOrder.push("medium");
        },
        10
      );

      const result = await executeGracefulShutdown("MANUAL", { timeoutMs: 1000 });

      expect(result.success).toBe(true);
      expect(callOrder).toEqual(["high", "medium", "low"]);
      expect(result.executedHooks).toEqual([
        "high-priority",
        "medium-priority",
        "low-priority",
      ]);
    });

    it("should allow unregistering a hook via returned callback", async () => {
      const executed: string[] = [];

      const unregister = registerShutdownHook("temporary", () => {
        executed.push("temporary");
      });

      registerShutdownHook("permanent", () => {
        executed.push("permanent");
      });

      unregister();

      const result = await executeGracefulShutdown("SIGTERM", { timeoutMs: 1000 });

      expect(result.success).toBe(true);
      expect(executed).toEqual(["permanent"]);
    });

    it("should update isShuttingDown state during and after shutdown", async () => {
      expect(isShuttingDown()).toBe(false);

      let wasShuttingDownInsideHook = false;
      registerShutdownHook("check-state", () => {
        wasShuttingDownInsideHook = isShuttingDown();
      });

      await executeGracefulShutdown("SIGINT", { timeoutMs: 1000 });

      expect(wasShuttingDownInsideHook).toBe(true);
      expect(isShuttingDown()).toBe(true);

      const state = getLifecycleState();
      expect(state.isShuttingDown).toBe(true);
      expect(state.signal).toBe("SIGINT");
      expect(state.startedAt).toBeTypeOf("number");
    });
  });

  describe("Re-entrancy and error handling", () => {
    it("should reject re-entrant shutdown attempts gracefully", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registerShutdownHook("first-run", async () => {
        // Attempt a nested shutdown call while shutting down
        const secondAttempt = await executeGracefulShutdown("SIGINT");
        expect(secondAttempt.success).toBe(false);
        expect(secondAttempt.errors.lifecycle).toContain("Shutdown already in progress");
      });

      const firstResult = await executeGracefulShutdown("SIGTERM", { timeoutMs: 1000 });
      expect(firstResult.success).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("should isolate failing hooks and continue executing remaining hooks", async () => {
      const executed: string[] = [];

      registerShutdownHook(
        "failing-hook",
        () => {
          throw new Error("Connection failed abruptly");
        },
        20
      );

      registerShutdownHook(
        "succeeding-hook",
        () => {
          executed.push("succeeded");
        },
        10
      );

      const result = await executeGracefulShutdown("SIGTERM", { timeoutMs: 1000 });

      expect(result.success).toBe(false);
      expect(executed).toContain("succeeded");
      expect(result.errors["failing-hook"]).toBe("Connection failed abruptly");
      expect(result.executedHooks).toContain("succeeding-hook");
    });

    it("should enforce timeout if a hook hangs indefinitely", async () => {
      registerShutdownHook(
        "hanging-hook",
        () => new Promise<void>(() => {}), // Never resolves
        10
      );

      const result = await executeGracefulShutdown("SIGTERM", { timeoutMs: 50 });

      expect(result.success).toBe(false);
      expect(result.errors["lifecycle:timeout"]).toContain("timed out after 50ms");
    });
  });

  describe("Configuration and signal handlers", () => {
    it("should respect SHUTDOWN_TIMEOUT_MS from environment", () => {
      const originalEnv = process.env.SHUTDOWN_TIMEOUT_MS;
      try {
        process.env.SHUTDOWN_TIMEOUT_MS = "8000";
        expect(getShutdownTimeoutMs()).toBe(8000);

        process.env.SHUTDOWN_TIMEOUT_MS = "invalid";
        expect(getShutdownTimeoutMs()).toBe(5000);
      } finally {
        if (originalEnv) {
          process.env.SHUTDOWN_TIMEOUT_MS = originalEnv;
        } else {
          delete process.env.SHUTDOWN_TIMEOUT_MS;
        }
      }
    });

    it("should install and tear down signal handlers safely", () => {
      const onceSpy = vi.spyOn(process, "once");
      const removeSpy = vi.spyOn(process, "removeListener");

      setupSignalHandlers({ force: true });
      expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));

      // Repeated call should be idempotent
      setupSignalHandlers({ force: true });

      teardownSignalHandlers();
      expect(removeSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    });
  });

  describe("Redis connection teardown", () => {
    it("should cleanly call quit() on active Redis client", async () => {
      const mockQuit = vi.fn().mockResolvedValue("OK");
      const mockDisconnect = vi.fn();

      const mockClient: RedisClientLike = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        quit: mockQuit,
        disconnect: mockDisconnect,
      };

      setRedisClientForTesting(mockClient);
      expect(hasActiveRedisClient()).toBe(true);
      expect(getActiveRedisClient()).toBe(mockClient);

      await disconnectRedis();

      expect(mockQuit).toHaveBeenCalledTimes(1);
      expect(mockDisconnect).not.toHaveBeenCalled();
      expect(hasActiveRedisClient()).toBe(false);
    });

    it("should fallback to disconnect() if quit() throws or times out", async () => {
      const mockQuit = vi.fn().mockRejectedValue(new Error("Network drop"));
      const mockDisconnect = vi.fn();

      const mockClient: RedisClientLike = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        quit: mockQuit,
        disconnect: mockDisconnect,
      };

      setRedisClientForTesting(mockClient);
      await disconnectRedis();

      expect(mockQuit).toHaveBeenCalledTimes(1);
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(hasActiveRedisClient()).toBe(false);
    });
  });

  describe("Prisma connection teardown", () => {
    it("should cleanly call $disconnect() on Prisma client", async () => {
      const disconnectSpy = vi
        .spyOn(prisma, "$disconnect")
        .mockResolvedValue(undefined as never);

      await disconnectPrisma();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it("should handle error in $disconnect() without crashing", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(prisma, "$disconnect").mockRejectedValue(
        new Error("Prisma engine already stopped")
      );

      await expect(disconnectPrisma()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
