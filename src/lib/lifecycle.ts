// SPDX-License-Identifier: MIT

/**
 * Centralized server lifecycle management.
 *
 * Kubernetes rolling deployments, Docker stops and process supervisors send
 * SIGTERM (and SIGINT from an operator's terminal). Without a handler the Node
 * process dies immediately: in-flight Prisma transactions are severed, the
 * Redis socket disappears without a QUIT, and the pool logs connection-leak
 * warnings. This module turns that hard stop into an ordered shutdown:
 *
 *   1. stop accepting new background work (`isShuttingDown()` / the
 *      `assertAcceptingOperations()` gate),
 *   2. drain in-flight asynchronous operations for a configurable grace
 *      period (`SHUTDOWN_GRACE_PERIOD_MS`, default 5 s),
 *   3. run every registered cleanup task (Prisma `$disconnect`, Redis `quit`,
 *      …) with whatever budget remains,
 *   4. emit one structured log line when shutdown starts and one when it
 *      completes.
 *
 * The handlers are installed only in production (`NODE_ENV=production`), so
 * `next dev` keeps its normal hot-reload behaviour: Next restarts its server
 * modules on edits and must not have a SIGTERM handler calling `process.exit`
 * underneath it. Tests (and non-Next workers) can opt in with
 * `installShutdownHandlers({ force: true })`.
 */

import { logger } from "@/lib/logger";

/** Default grace period for draining in-flight work, in milliseconds. */
export const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 5_000;

/**
 * Floor for a single cleanup task once the drain budget is exhausted. A
 * `$disconnect()`/`quit()` that is given zero milliseconds would be pointless,
 * so cleanup always gets at least this long.
 */
const MIN_CLEANUP_BUDGET_MS = 1_000;

export interface ShutdownTask {
  /** Stable name used for de-duplication and logs (e.g. "prisma"). */
  name: string;
  /** Cleanup work. Runs once per process; must not throw to signal success. */
  run: () => Promise<unknown> | unknown;
}

export interface ShutdownReport {
  signal: string;
  gracePeriodMs: number;
  /** In-flight operations that were still running when shutdown began. */
  inFlightAtStart: number;
  /** True when every tracked operation finished inside the grace period. */
  drained: boolean;
  durationMs: number;
  tasks: Array<{
    name: string;
    status: "fulfilled" | "rejected";
    error?: string;
  }>;
}

export interface ShutdownOptions {
  gracePeriodMs?: number;
}

export interface InstallShutdownHandlersOptions extends ShutdownOptions {
  /**
   * Install even outside production. Used by tests and by non-Next workers
   * that run with NODE_ENV unset.
   */
  force?: boolean;
  /**
   * Call `process.exit(0)` after cleanup. Defaults to true; tests pass false
   * so the runner survives.
   */
  exitOnComplete?: boolean;
}

/** Thrown by `assertAcceptingOperations()` once shutdown has begun. */
export class ShutdownInProgressError extends Error {
  readonly code = "SERVER_SHUTTING_DOWN";

  constructor(operation = "operation") {
    super(`Cannot start ${operation}: the server is shutting down.`);
    this.name = "ShutdownInProgressError";
  }
}

// ── State ─────────────────────────────────────────────────────
//
// Module-level state is intentional: it is shared by every importer within one
// server process. `registerShutdownTask` de-duplicates by name, so a hot-reload
// that re-evaluates prisma.ts/redis.ts cannot register the same cleanup twice.

let tasks: ShutdownTask[] = [];
let handlersInstalled = false;
let installedHandlers: Partial<Record<NodeJS.Signals, () => void>> = {};
let exitOnComplete = true;

let shuttingDown = false;
let shutdownPromise: Promise<ShutdownReport> | null = null;

let inFlight = 0;
let idleWaiters: Array<() => void> = [];

// ── Configuration ─────────────────────────────────────────────

/**
 * Grace period read from `SHUTDOWN_GRACE_PERIOD_MS`. Invalid, non-positive or
 * unset values fall back to 5 seconds — the Kubernetes default
 * `terminationGracePeriodSeconds` leaves room for it.
 */
export function getShutdownGracePeriodMs(): number {
  const raw = process.env.SHUTDOWN_GRACE_PERIOD_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
  }
  return Math.floor(parsed);
}

// ── Task registry ─────────────────────────────────────────────

/**
 * Register a cleanup task. Returns an unregister function.
 *
 * Registering the same `name` twice replaces the previous entry, which is what
 * makes development hot-reload and duplicate module evaluation safe.
 */
export function registerShutdownTask(task: ShutdownTask): () => void {
  tasks = tasks.filter((t) => t.name !== task.name);
  tasks.push(task);
  return () => unregisterShutdownTask(task.name);
}

export function unregisterShutdownTask(name: string): void {
  tasks = tasks.filter((t) => t.name !== name);
}

/** Names of the registered cleanup tasks, in registration order. */
export function getShutdownTaskNames(): string[] {
  return tasks.map((t) => t.name);
}

// ── Operation tracking ────────────────────────────────────────

/** True once a shutdown signal has been received. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Guard for background loops and schedulers: refuse to start new work while
 * the process is draining. Request handlers do not need this — the HTTP
 * server stops accepting connections first — but a polling loop must stop
 * enqueueing new jobs.
 */
export function assertAcceptingOperations(operation = "operation"): void {
  if (shuttingDown) throw new ShutdownInProgressError(operation);
}

/**
 * Mark an asynchronous operation as in-flight. The returned release function is
 * idempotent and must be called when the operation settles. Shutdown waits for
 * the counter to reach zero before disconnecting clients.
 */
export function beginAsyncOperation(): () => void {
  inFlight += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const waiter of waiters) waiter();
    }
  };
}

/** Track a promise for the duration of `beginAsyncOperation()`. */
export async function trackAsyncOperation<T>(operation: Promise<T>): Promise<T> {
  const release = beginAsyncOperation();
  try {
    return await operation;
  } finally {
    release();
  }
}

/** Number of operations currently tracked. Exposed for tests and metrics. */
export function getInFlightOperationCount(): number {
  return inFlight;
}

/**
 * Resolve once no tracked operations remain, or when `timeoutMs` elapses.
 * Returns true when the process drained inside the budget.
 */
export function waitForInFlightOperations(timeoutMs: number): Promise<boolean> {
  if (inFlight === 0) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      idleWaiters = idleWaiters.filter((w) => w !== finish);
      resolve(inFlight === 0);
    };

    const timer = setTimeout(finish, Math.max(0, timeoutMs));
    // A long grace period must not keep the event loop alive by itself; the
    // signal handler's process.exit is what terminates the process.
    timer.unref?.();
    idleWaiters.push(finish);
  });
}

// ── Shutdown ──────────────────────────────────────────────────

async function runTaskWithTimeout(
  task: ShutdownTask,
  timeoutMs: number
): Promise<ShutdownReport["tasks"][number]> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`cleanup task "${task.name}" timed out`)),
      timeoutMs
    );
    timer.unref?.();
  });

  try {
    await Promise.race([Promise.resolve().then(task.run), timeout]);
    return { name: task.name, status: "fulfilled" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn("Graceful shutdown cleanup task failed", {
      task: task.name,
      error,
    });
    return { name: task.name, status: "rejected", error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run the shutdown sequence. Idempotent: concurrent callers (SIGTERM followed
 * by SIGINT, or a health probe racing the supervisor) share one promise.
 */
export function shutdown(
  signal = "SIGTERM",
  options: ShutdownOptions = {}
): Promise<ShutdownReport> {
  if (shutdownPromise) return shutdownPromise;

  const gracePeriodMs = options.gracePeriodMs ?? getShutdownGracePeriodMs();
  const startedAt = Date.now();
  const inFlightAtStart = inFlight;

  shuttingDown = true;

  logger.info("Graceful shutdown started", {
    signal,
    gracePeriodMs,
    inFlightOperations: inFlightAtStart,
    tasks: getShutdownTaskNames(),
  });

  shutdownPromise = (async (): Promise<ShutdownReport> => {
    const drained = await waitForInFlightOperations(gracePeriodMs);

    if (!drained) {
      logger.warn("Graceful shutdown grace period elapsed with operations still in flight", {
        signal,
        gracePeriodMs,
        inFlightOperations: inFlight,
      });
    }

    const remaining = Math.max(
      MIN_CLEANUP_BUDGET_MS,
      gracePeriodMs - (Date.now() - startedAt)
    );

    const results = await Promise.all(
      tasks.map((task) => runTaskWithTimeout(task, remaining))
    );

    const report: ShutdownReport = {
      signal,
      gracePeriodMs,
      inFlightAtStart,
      drained,
      durationMs: Date.now() - startedAt,
      tasks: results,
    };

    const failed = results.filter((t) => t.status === "rejected");
    const log = failed.length > 0 ? logger.warn : logger.info;
    log("Graceful shutdown complete", {
      signal,
      durationMs: report.durationMs,
      drained,
      inFlightAtStart,
      completedTasks: results.filter((t) => t.status === "fulfilled").map((t) => t.name),
      failedTasks: failed.map((t) => t.name),
    });

    return report;
  })();

  return shutdownPromise;
}

// ── Signal handlers ───────────────────────────────────────────

/**
 * Install SIGTERM/SIGINT handlers.
 *
 * Returns false when handlers are already installed or when running outside
 * production without `force`. Installing twice is a no-op so a hot reload
 * cannot stack listeners (Node warns after ten).
 */
export function installShutdownHandlers(
  options: InstallShutdownHandlersOptions = {}
): boolean {
  if (handlersInstalled) return false;
  if (!options.force && process.env.NODE_ENV !== "production") return false;
  if (typeof process.once !== "function") return false;

  exitOnComplete = options.exitOnComplete !== false;
  const gracePeriodMs = options.gracePeriodMs;

  const handle = (signal: NodeJS.Signals) => {
    void shutdown(signal, { gracePeriodMs }).finally(() => {
      if (exitOnComplete) process.exit(0);
    });
  };

  const onSigterm = () => handle("SIGTERM");
  const onSigint = () => handle("SIGINT");
  installedHandlers = { SIGTERM: onSigterm, SIGINT: onSigint };

  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  handlersInstalled = true;

  logger.info("Graceful shutdown handlers installed", {
    signals: ["SIGTERM", "SIGINT"],
    gracePeriodMs: gracePeriodMs ?? getShutdownGracePeriodMs(),
    exitOnComplete,
  });

  return true;
}

/** Whether the signal handlers are currently installed. */
export function areShutdownHandlersInstalled(): boolean {
  return handlersInstalled;
}

/**
 * Restore the module to its pre-boot state. Test-only: removes the signal
 * listeners and clears the registry, drain counters and memoized shutdown
 * promise.
 */
export function resetLifecycleForTests(): void {
  for (const [signal, handler] of Object.entries(installedHandlers)) {
    if (handler) process.removeListener(signal as NodeJS.Signals, handler);
  }
  installedHandlers = {};
  handlersInstalled = false;
  exitOnComplete = true;

  tasks = [];
  shuttingDown = false;
  shutdownPromise = null;
  inFlight = 0;
  idleWaiters = [];
}
