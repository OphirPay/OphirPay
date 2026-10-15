// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma and redis modules before importing lifecycle
vi.mock("@/lib/prisma", () => ({
  default: {
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
  disconnectPrisma: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/redis", () => ({
  disconnectRedis: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { disconnectPrisma } from "@/lib/prisma";
import { disconnectRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import {
  isShuttingDown,
  getInFlightCount,
  trackOperation,
  registerShutdownHook,
  performGracefulShutdown,
  registerShutdownHandlers,
  resetLifecycleState,
} from "@/lib/lifecycle";

describe("Lifecycle & Graceful Shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLifecycleState();
  });

  afterEach(() => {
    resetLifecycleState();
  });

  it("initializes with isShuttingDown = false and inFlightCount = 0", () => {
    expect(isShuttingDown()).toBe(false);
    expect(getInFlightCount()).toBe(0);
  });

  it("tracks in-flight asynchronous operations accurately", async () => {
    let insideOperation = false;

    const opPromise = trackOperation(async () => {
      insideOperation = true;
      expect(getInFlightCount()).toBe(1);
      await new Promise((r) => setTimeout(r, 20));
      return "success";
    });

    expect(getInFlightCount()).toBe(1);
    const result = await opPromise;
    expect(result).toBe("success");
    expect(insideOperation).toBe(true);
    expect(getInFlightCount()).toBe(0);
  });

  it("handles errors in tracked operations and restores in-flight count", async () => {
    await expect(
      trackOperation(async () => {
        expect(getInFlightCount()).toBe(1);
        throw new Error("Operation failed");
      })
    ).rejects.toThrow("Operation failed");

    expect(getInFlightCount()).toBe(0);
  });

  it("executes graceful shutdown sequence and closes connections", async () => {
    const customHook = vi.fn().mockResolvedValue(undefined);
    registerShutdownHook(customHook);

    await performGracefulShutdown("SIGTERM", { exitOnComplete: false });

    expect(isShuttingDown()).toBe(true);
    expect(customHook).toHaveBeenCalledWith("SIGTERM");
    expect(disconnectPrisma).toHaveBeenCalled();
    expect(disconnectRedis).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "Graceful shutdown initiated",
      expect.objectContaining({ signal: "SIGTERM" })
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Graceful shutdown completed",
      expect.objectContaining({ signal: "SIGTERM" })
    );
  });

  it("blocks new operations when shutdown is in progress", async () => {
    await performGracefulShutdown("SIGINT", { exitOnComplete: false });

    await expect(
      trackOperation(async () => "new_work")
    ).rejects.toThrow("Cannot initiate new operation: process is shutting down");
  });

  it("waits for in-flight operations to drain before disconnecting resources", async () => {
    let operationCompleted = false;

    // Start long-running in-flight operation
    const op = trackOperation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      operationCompleted = true;
      return "done";
    });

    // Initiate shutdown concurrently
    const shutdownPromise = performGracefulShutdown("SIGTERM", {
      timeoutMs: 1000,
      exitOnComplete: false,
    });

    await Promise.all([op, shutdownPromise]);

    expect(operationCompleted).toBe(true);
    expect(disconnectPrisma).toHaveBeenCalled();
    expect(disconnectRedis).toHaveBeenCalled();
  });

  it("warns when operations exceed the shutdown timeout", async () => {
    // Operation that will not complete before timeout
    trackOperation(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 500);
        })
    );

    // Shutdown with short timeout
    await performGracefulShutdown("SIGTERM", {
      timeoutMs: 30,
      exitOnComplete: false,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Graceful shutdown timeout exceeded while draining operations",
      expect.objectContaining({
        signal: "SIGTERM",
        remainingOperations: 1,
        timeoutMs: 30,
      })
    );
    expect(disconnectPrisma).toHaveBeenCalled();
    expect(disconnectRedis).toHaveBeenCalled();
  });

  it("tolerates errors in individual shutdown hooks", async () => {
    const faultyHook = vi.fn().mockRejectedValue(new Error("Hook failed"));
    const healthyHook = vi.fn().mockResolvedValue(undefined);

    registerShutdownHook(faultyHook);
    registerShutdownHook(healthyHook);

    await performGracefulShutdown("SIGTERM", { exitOnComplete: false });

    expect(faultyHook).toHaveBeenCalled();
    expect(healthyHook).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Error executing shutdown hook",
      expect.objectContaining({ signal: "SIGTERM", error: "Hook failed" })
    );
    expect(disconnectPrisma).toHaveBeenCalled();
  });

  it("registers process signal handlers without error", () => {
    expect(() => registerShutdownHandlers({ exitOnComplete: false })).not.toThrow();
  });
});
