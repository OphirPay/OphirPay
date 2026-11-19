// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHUTDOWN_GRACE_PERIOD_MS,
  ShutdownInProgressError,
  areShutdownHandlersInstalled,
  assertAcceptingOperations,
  beginAsyncOperation,
  getInFlightOperationCount,
  getShutdownGracePeriodMs,
  getShutdownTaskNames,
  installShutdownHandlers,
  isShuttingDown,
  registerShutdownTask,
  resetLifecycleForTests,
  shutdown,
  unregisterShutdownTask,
  waitForInFlightOperations,
} from "@/lib/lifecycle";

describe("graceful shutdown lifecycle", () => {
  beforeEach(() => {
    resetLifecycleForTests();
    delete process.env.SHUTDOWN_GRACE_PERIOD_MS;
  });

  afterEach(() => {
    resetLifecycleForTests();
    delete process.env.SHUTDOWN_GRACE_PERIOD_MS;
    vi.restoreAllMocks();
  });

  describe("grace period configuration", () => {
    it("defaults to 5 seconds", () => {
      expect(getShutdownGracePeriodMs()).toBe(DEFAULT_SHUTDOWN_GRACE_PERIOD_MS);
      expect(DEFAULT_SHUTDOWN_GRACE_PERIOD_MS).toBe(5_000);
    });

    it("reads SHUTDOWN_GRACE_PERIOD_MS", () => {
      process.env.SHUTDOWN_GRACE_PERIOD_MS = "1200";
      expect(getShutdownGracePeriodMs()).toBe(1_200);
    });

    it("falls back for invalid or non-positive values", () => {
      process.env.SHUTDOWN_GRACE_PERIOD_MS = "not-a-number";
      expect(getShutdownGracePeriodMs()).toBe(DEFAULT_SHUTDOWN_GRACE_PERIOD_MS);
      process.env.SHUTDOWN_GRACE_PERIOD_MS = "0";
      expect(getShutdownGracePeriodMs()).toBe(DEFAULT_SHUTDOWN_GRACE_PERIOD_MS);
      process.env.SHUTDOWN_GRACE_PERIOD_MS = "-50";
      expect(getShutdownGracePeriodMs()).toBe(DEFAULT_SHUTDOWN_GRACE_PERIOD_MS);
    });
  });

  describe("task registry", () => {
    it("registers cleanup tasks and reports their names", () => {
      registerShutdownTask({ name: "prisma", run: vi.fn() });
      registerShutdownTask({ name: "redis", run: vi.fn() });
      expect(getShutdownTaskNames()).toEqual(["prisma", "redis"]);
    });

    it("replaces a duplicate name instead of stacking cleanup work", () => {
      const first = vi.fn();
      const second = vi.fn();
      registerShutdownTask({ name: "prisma", run: first });
      registerShutdownTask({ name: "prisma", run: second });
      expect(getShutdownTaskNames()).toEqual(["prisma"]);
      expect(first).not.toHaveBeenCalled();
      return shutdown("SIGTERM").then(() => {
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
      });
    });

    it("unregisters through the returned function", () => {
      const unregister = registerShutdownTask({ name: "redis", run: vi.fn() });
      unregister();
      expect(getShutdownTaskNames()).toEqual([]);
      unregisterShutdownTask("missing");
      expect(getShutdownTaskNames()).toEqual([]);
    });
  });

  describe("in-flight operation tracking", () => {
    it("counts operations until their release is called", () => {
      const release = beginAsyncOperation();
      expect(getInFlightOperationCount()).toBe(1);
      release();
      release(); // idempotent
      expect(getInFlightOperationCount()).toBe(0);
    });

    it("waits for tracked work to settle inside the grace period", async () => {
      const release = beginAsyncOperation();
      setTimeout(release, 20);

      await expect(waitForInFlightOperations(1_000)).resolves.toBe(true);
      expect(getInFlightOperationCount()).toBe(0);
    });

    it("returns false when the grace period elapses first", async () => {
      beginAsyncOperation(); // deliberately never released
      await expect(waitForInFlightOperations(5)).resolves.toBe(false);
    });

    it("gates new background work once shutdown begins", async () => {
      const report = await shutdown("SIGTERM", { gracePeriodMs: 5 });
      expect(report.signal).toBe("SIGTERM");
      expect(isShuttingDown()).toBe(true);
      expect(() => assertAcceptingOperations("webhook delivery")).toThrow(
        ShutdownInProgressError
      );
      expect(() => assertAcceptingOperations("webhook delivery")).toThrow(
        /webhook delivery/
      );
    });
  });

  describe("shutdown sequence", () => {
    it("drains in-flight work before running cleanup tasks", async () => {
      const order: string[] = [];
      const release = beginAsyncOperation();
      setTimeout(() => {
        order.push("query-finished");
        release();
      }, 20);
      registerShutdownTask({
        name: "prisma",
        run: async () => {
          order.push("prisma-disconnected");
        },
      });

      const report = await shutdown("SIGTERM", { gracePeriodMs: 1_000 });

      expect(order).toEqual(["query-finished", "prisma-disconnected"]);
      expect(report.drained).toBe(true);
      expect(report.inFlightAtStart).toBe(1);
      expect(report.tasks).toEqual([{ name: "prisma", status: "fulfilled" }]);
    });

    it("runs every cleanup task exactly once and survives failures", async () => {
      const prisma = vi.fn().mockResolvedValue(undefined);
      const redis = vi.fn().mockRejectedValue(new Error("broker gone"));
      registerShutdownTask({ name: "prisma", run: prisma });
      registerShutdownTask({ name: "redis", run: redis });

      const report = await shutdown("SIGINT", { gracePeriodMs: 50 });

      expect(prisma).toHaveBeenCalledOnce();
      expect(redis).toHaveBeenCalledOnce();
      expect(report.tasks).toEqual([
        { name: "prisma", status: "fulfilled" },
        {
          name: "redis",
          status: "rejected",
          error: "broker gone",
        },
      ]);
    });

    it("is idempotent across concurrent signals", async () => {
      const task = vi.fn().mockResolvedValue(undefined);
      registerShutdownTask({ name: "prisma", run: task });

      const [first, second] = await Promise.all([
        shutdown("SIGTERM", { gracePeriodMs: 50 }),
        shutdown("SIGINT", { gracePeriodMs: 50 }),
      ]);

      expect(first).toBe(second);
      expect(task).toHaveBeenCalledOnce();
      // The first signal wins the label; the second joins the same sequence.
      expect(first.signal).toBe("SIGTERM");
    });

    it("proceeds with cleanup when the drain budget is exhausted", async () => {
      beginAsyncOperation(); // never released
      const task = vi.fn().mockResolvedValue(undefined);
      registerShutdownTask({ name: "prisma", run: task });

      const report = await shutdown("SIGTERM", { gracePeriodMs: 5 });

      expect(report.drained).toBe(false);
      expect(task).toHaveBeenCalledOnce();
    });
  });

  describe("signal handlers", () => {
    it("does not install handlers outside production by default", () => {
      vi.stubEnv("NODE_ENV", "development");
      const before = process.listenerCount("SIGTERM");
      expect(installShutdownHandlers()).toBe(false);
      expect(areShutdownHandlersInstalled()).toBe(false);
      expect(process.listenerCount("SIGTERM")).toBe(before);
    });

    it("installs once when forced and removes listeners on reset", () => {
      const beforeTerm = process.listenerCount("SIGTERM");
      const beforeInt = process.listenerCount("SIGINT");

      expect(installShutdownHandlers({ force: true, exitOnComplete: false })).toBe(
        true
      );
      expect(installShutdownHandlers({ force: true })).toBe(false);
      expect(areShutdownHandlersInstalled()).toBe(true);
      expect(process.listenerCount("SIGTERM")).toBe(beforeTerm + 1);
      expect(process.listenerCount("SIGINT")).toBe(beforeInt + 1);

      resetLifecycleForTests();
      expect(areShutdownHandlersInstalled()).toBe(false);
      expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
      expect(process.listenerCount("SIGINT")).toBe(beforeInt);
    });

    it("runs the shutdown sequence when a signal is delivered", async () => {
      const task = vi.fn().mockResolvedValue(undefined);
      registerShutdownTask({ name: "prisma", run: task });

      installShutdownHandlers({
        force: true,
        exitOnComplete: false,
        gracePeriodMs: 50,
      });

      process.emit("SIGTERM");

      const report = await shutdown("SIGTERM", { gracePeriodMs: 50 });
      expect(report.signal).toBe("SIGTERM");
      expect(task).toHaveBeenCalledOnce();
      expect(isShuttingDown()).toBe(true);
    });
  });
});
