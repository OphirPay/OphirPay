// SPDX-License-Identifier: MIT

import { logger } from "@/lib/logger";
import { disconnectPrisma } from "@/lib/prisma";
import { disconnectRedis } from "@/lib/redis";

export type ShutdownHook = (signal: string) => Promise<void> | void;

interface LifecycleOptions {
  timeoutMs?: number;
  exitOnComplete?: boolean;
}

let shuttingDown = false;
let handlersRegistered = false;
let inFlightCount = 0;
const inFlightDrainedResolvers: Array<() => void> = [];
const shutdownHooks: ShutdownHook[] = [];

/**
 * Returns true if a process shutdown sequence has been initiated.
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Returns the current number of tracked in-flight operations.
 */
export function getInFlightCount(): number {
  return inFlightCount;
}

/**
 * Track an asynchronous operation to ensure it finishes or times out
 * before resources (database, cache) are severed.
 */
export async function trackOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (shuttingDown) {
    throw new Error("Cannot initiate new operation: process is shutting down");
  }

  inFlightCount++;
  try {
    return await operation();
  } finally {
    inFlightCount--;
    if (inFlightCount === 0) {
      while (inFlightDrainedResolvers.length > 0) {
        const resolve = inFlightDrainedResolvers.shift();
        resolve?.();
      }
    }
  }
}

/**
 * Register a custom shutdown hook to execute during process termination.
 */
export function registerShutdownHook(hook: ShutdownHook): void {
  shutdownHooks.push(hook);
}

/**
 * Clears registered shutdown hooks and resets state (primarily for tests).
 */
export function resetLifecycleState(): void {
  shuttingDown = false;
  inFlightCount = 0;
  inFlightDrainedResolvers.length = 0;
  shutdownHooks.length = 0;
}

/**
 * Wait until all tracked in-flight operations finish or the timeout expires.
 */
async function waitForInFlightOperations(timeoutMs: number): Promise<boolean> {
  if (inFlightCount === 0) return true;

  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });

  const drainPromise = new Promise<boolean>((resolve) => {
    inFlightDrainedResolvers.push(() => resolve(true));
  });

  try {
    return await Promise.race([drainPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Performs the graceful shutdown sequence for the application.
 */
export async function performGracefulShutdown(
  signal = "SIGTERM",
  options: LifecycleOptions = {}
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  const exitOnComplete = options.exitOnComplete ?? (process.env.NODE_ENV === "production");

  logger.info("Graceful shutdown initiated", {
    signal,
    inFlightOperations: inFlightCount,
    timeoutMs,
  });

  // 1. Await in-flight requests / background tasks
  const drainedCleanly = await waitForInFlightOperations(timeoutMs);
  if (!drainedCleanly) {
    logger.warn("Graceful shutdown timeout exceeded while draining operations", {
      signal,
      remainingOperations: inFlightCount,
      timeoutMs,
    });
  }

  // 2. Execute custom shutdown hooks
  for (const hook of shutdownHooks) {
    try {
      await hook(signal);
    } catch (err) {
      logger.error("Error executing shutdown hook", {
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Gracefully disconnect databases and caches
  await Promise.allSettled([disconnectPrisma(), disconnectRedis()]);

  const durationMs = Date.now() - start;
  logger.info("Graceful shutdown completed", {
    signal,
    durationMs,
  });

  // 4. In production environments, exit cleanly
  if (exitOnComplete) {
    process.exit(0);
  }
}

/**
 * Register process signal handlers for SIGTERM and SIGINT.
 * Avoids duplicate registration and respects development hot-reload environments.
 */
export function registerShutdownHandlers(options: LifecycleOptions = {}): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const onSignal = (signal: string) => {
    performGracefulShutdown(signal, options).catch((err) => {
      logger.error("Fatal error during graceful shutdown", {
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
  };

  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
}
