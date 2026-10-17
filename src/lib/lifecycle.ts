// SPDX-License-Identifier: MIT
/**
 * Centralized Graceful Shutdown & Connection Lifecycle Manager (Issue #1311).
 *
 * Coordinates clean teardown when the Next.js server or containerized worker
 * receives `SIGTERM` or `SIGINT`:
 *   1. Flips `isShuttingDown()` to `true` so new background/async operations
 *      cease starting.
 *   2. Waits up to a configurable grace period (default: 5,000 ms) for all
 *      tracked in-flight database/background operations to settle.
 *   3. Invokes `await prisma.$disconnect()` and `await redis.quit()` across
 *      registered clients.
 *   4. Emits structured logs at shutdown start and completion.
 *   5. Avoids duplicate signal listener registration across `next dev` HMR
 *      reloads.
 */

import { logger } from "@/lib/logger";
import {
  disconnectRedisClients,
  registerRedisClient,
  resetRedisClientsForTests,
  type RedisClientLike,
} from "@/lib/redis";

export const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 5_000;

export interface PrismaClientLike {
  $disconnect: () => Promise<void>;
}

export class ShutdownInProgressError extends Error {
  public readonly code = "SHUTDOWN_IN_PROGRESS";

  constructor(label?: string) {
    super(
      label
        ? `Cannot start operation "${label}" while graceful shutdown is in progress`
        : "Cannot start new operation while graceful shutdown is in progress"
    );
    this.name = "ShutdownInProgressError";
  }
}

export interface ShutdownSummary {
  signal: string;
  durationMs: number;
  drainedCleanly: boolean;
  remainingInFlight: number;
  prismaDisconnected: number;
  redisDisconnected: number;
}

export interface RegisterShutdownOptions {
  gracePeriodMs?: number;
  /** Allow registering process signal handlers even when NODE_ENV === "development". */
  forceInDev?: boolean;
  processTarget?: Pick<NodeJS.Process, "on" | "removeListener" | "env">;
}

interface LifecycleGlobalState {
  shuttingDown: boolean;
  shutdownPromise: Promise<ShutdownSummary> | null;
  inFlight: Set<Promise<unknown>>;
  prismaClients: Set<PrismaClientLike>;
  handlersRegistered: boolean;
  unregisterFn: (() => void) | null;
}

const globalForLifecycle = globalThis as unknown as {
  __ophirpayLifecycle?: LifecycleGlobalState;
};

function getState(): LifecycleGlobalState {
  if (!globalForLifecycle.__ophirpayLifecycle) {
    globalForLifecycle.__ophirpayLifecycle = {
      shuttingDown: false,
      shutdownPromise: null,
      inFlight: new Set<Promise<unknown>>(),
      prismaClients: new Set<PrismaClientLike>(),
      handlersRegistered: false,
      unregisterFn: null,
    };
  }
  return globalForLifecycle.__ophirpayLifecycle;
}

export function getShutdownGracePeriodMs(): number {
  const raw = Number(process.env.SHUTDOWN_GRACE_PERIOD_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
}

/**
 * Returns `true` once a `SIGTERM` / `SIGINT` graceful shutdown sequence has begun.
 */
export function isShuttingDown(): boolean {
  return getState().shuttingDown;
}

/**
 * Number of currently active in-flight operations being tracked.
 */
export function getInFlightOperationCount(): number {
  return getState().inFlight.size;
}

/**
 * Register a Prisma client instance to be disconnected during graceful shutdown.
 */
export function registerPrismaClient<T extends PrismaClientLike>(client: T): T {
  if (client && typeof client.$disconnect === "function") {
    getState().prismaClients.add(client);
  }
  return client;
}

export { registerRedisClient, type RedisClientLike };

/**
 * Track an asynchronous database or background operation so graceful shutdown
 * waits for it to settle before disconnecting Prisma and Redis.
 *
 * Rejects with `ShutdownInProgressError` if shutdown has already started
 * (unless `allowDuringShutdown` is set).
 */
export async function trackInFlightOperation<T>(
  operation: () => Promise<T> | T,
  options?: { label?: string; allowDuringShutdown?: boolean }
): Promise<T> {
  const state = getState();
  if (state.shuttingDown && !options?.allowDuringShutdown) {
    throw new ShutdownInProgressError(options?.label);
  }

  let trackedPromise!: Promise<T>;
  trackedPromise = Promise.resolve()
    .then(() => operation())
    .finally(() => {
      state.inFlight.delete(trackedPromise);
    });

  state.inFlight.add(trackedPromise);
  return trackedPromise;
}

async function waitForInFlightDrain(gracePeriodMs: number): Promise<boolean> {
  const state = getState();
  if (state.inFlight.size === 0) {
    return true;
  }

  const drainAll = Promise.allSettled(Array.from(state.inFlight)).then(() => true);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), gracePeriodMs);
  });

  try {
    return await Promise.race([drainAll, timeoutPromise]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/**
 * Execute the graceful shutdown sequence (idempotent).
 */
export function initiateGracefulShutdown(
  signal = "SIGTERM",
  options?: { gracePeriodMs?: number }
): Promise<ShutdownSummary> {
  const state = getState();
  if (state.shutdownPromise) {
    return state.shutdownPromise;
  }

  state.shuttingDown = true;
  const gracePeriodMs = options?.gracePeriodMs ?? getShutdownGracePeriodMs();
  const startTime = Date.now();
  const initialInFlight = state.inFlight.size;

  logger.info("Graceful shutdown initiated", {
    signal,
    inFlightCount: initialInFlight,
    gracePeriodMs,
  });

  state.shutdownPromise = (async (): Promise<ShutdownSummary> => {
    const drainedCleanly = await waitForInFlightDrain(gracePeriodMs);
    const remainingInFlight = state.inFlight.size;

    if (!drainedCleanly && remainingInFlight > 0) {
      logger.warn("Graceful shutdown drain window expired with operations still in flight", {
        signal,
        remainingInFlight,
        gracePeriodMs,
      });
    }

    // Disconnect all registered Prisma clients
    let prismaDisconnected = 0;
    const prismaList = Array.from(state.prismaClients);
    state.prismaClients.clear();
    for (const client of prismaList) {
      try {
        await client.$disconnect();
        prismaDisconnected += 1;
      } catch (err) {
        logger.error("Failed to disconnect Prisma client during shutdown", {
          signal,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Disconnect all registered Redis clients via quit()
    const redisDisconnected = await disconnectRedisClients();

    const durationMs = Date.now() - startTime;
    const summary: ShutdownSummary = {
      signal,
      durationMs,
      drainedCleanly,
      remainingInFlight,
      prismaDisconnected,
      redisDisconnected,
    };

    logger.info("Graceful shutdown completed", {
      signal,
      durationMs,
      drainedCleanly,
      remainingInFlight,
      prismaDisconnected,
      redisDisconnected,
    });

    return summary;
  })();

  return state.shutdownPromise;
}

/**
 * Register `SIGTERM` and `SIGINT` listeners on the process.
 *
 * Safe for `next dev` hot-reload: skips attaching process listeners in
 * `development` mode unless `forceInDev: true` is passed, and deduplicates
 * registration across module reloads via `globalThis`.
 */
export function registerShutdownHandlers(
  options: RegisterShutdownOptions = {}
): () => void {
  const state = getState();
  const proc = options.processTarget ?? process;
  const nodeEnv = proc.env?.NODE_ENV ?? process.env.NODE_ENV;

  if (nodeEnv === "development" && !options.forceInDev) {
    return () => {};
  }

  if (state.handlersRegistered && state.unregisterFn) {
    return state.unregisterFn;
  }

  const onSigTerm = () => {
    void initiateGracefulShutdown("SIGTERM", {
      gracePeriodMs: options.gracePeriodMs,
    });
  };
  const onSigInt = () => {
    void initiateGracefulShutdown("SIGINT", {
      gracePeriodMs: options.gracePeriodMs,
    });
  };

  proc.on("SIGTERM", onSigTerm);
  proc.on("SIGINT", onSigInt);

  const unregister = () => {
    proc.removeListener("SIGTERM", onSigTerm);
    proc.removeListener("SIGINT", onSigInt);
    state.handlersRegistered = false;
    state.unregisterFn = null;
  };

  state.handlersRegistered = true;
  state.unregisterFn = unregister;
  return unregister;
}

/**
 * Reset all lifecycle state and unregister listeners (intended for unit tests).
 */
export function resetLifecycleStateForTests(): void {
  const state = getState();
  state.unregisterFn?.();
  state.shuttingDown = false;
  state.shutdownPromise = null;
  state.inFlight.clear();
  state.prismaClients.clear();
  state.handlersRegistered = false;
  state.unregisterFn = null;
  resetRedisClientsForTests();
}
