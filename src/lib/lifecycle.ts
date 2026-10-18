// SPDX-License-Identifier: MIT

/**
 * @file lifecycle.ts
 * Centralized graceful shutdown and process lifecycle management for OphirPay.
 * Handles SIGTERM and SIGINT signals, coordinates clean disconnection of
 * Prisma and Redis connections, enforces configurable grace periods, and
 * prevents unhandled connection leaks during rolling deployments.
 */

export interface ShutdownHook {
  name: string;
  fn: () => Promise<void> | void;
  priority: number; // Higher numbers run first
}

export interface LifecycleState {
  isShuttingDown: boolean;
  signal: string | null;
  startedAt: number | null;
}

const DEFAULT_GRACE_PERIOD_MS = 5_000;

// Internal state
const state: LifecycleState = {
  isShuttingDown: false,
  signal: null,
  startedAt: null,
};

const hooks: ShutdownHook[] = [];
let signalHandlersInstalled = false;
let sigtermListener: (() => void) | null = null;
let sigintListener: (() => void) | null = null;

/**
 * Returns true if the application process is currently executing a shutdown sequence.
 * Mutation routes and background workers can check this to reject new operations.
 */
export function isShuttingDown(): boolean {
  return state.isShuttingDown;
}

/**
 * Get a snapshot of the current lifecycle state.
 */
export function getLifecycleState(): Readonly<LifecycleState> {
  return { ...state };
}

/**
 * Get configured grace period timeout in milliseconds.
 */
export function getShutdownTimeoutMs(): number {
  const envVal = process.env.SHUTDOWN_TIMEOUT_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_GRACE_PERIOD_MS;
}

/**
 * Register a cleanup hook to execute during graceful shutdown.
 * Hooks with higher priority numbers execute before lower priority ones.
 *
 * @param name Diagnostic identifier for the hook
 * @param fn Asynchronous or synchronous cleanup routine
 * @param priority Execution order priority (default: 10). Database/cache teardown should use lower priority (e.g. 5).
 */
export function registerShutdownHook(
  name: string,
  fn: () => Promise<void> | void,
  priority = 10
): () => void {
  // If a hook with the same name already exists, replace it
  const existingIndex = hooks.findIndex((h) => h.name === name);
  const hookItem: ShutdownHook = { name, fn, priority };

  if (existingIndex >= 0) {
    hooks[existingIndex] = hookItem;
  } else {
    hooks.push(hookItem);
  }

  // Return unregister callback
  return () => {
    const idx = hooks.findIndex((h) => h.name === name);
    if (idx >= 0) {
      hooks.splice(idx, 1);
    }
  };
}

/**
 * Remove all registered shutdown hooks (primarily for test isolation).
 */
export function clearShutdownHooks(): void {
  hooks.length = 0;
}

/**
 * Reset lifecycle internal state (primarily for test isolation).
 */
export function resetLifecycleState(): void {
  state.isShuttingDown = false;
  state.signal = null;
  state.startedAt = null;
}

/**
 * Execute all registered shutdown hooks in priority order with timeout protection.
 *
 * @param signal The OS signal triggering the shutdown (e.g., 'SIGTERM', 'SIGINT', or 'MANUAL')
 * @param options.timeoutMs Optional override for timeout
 * @param options.exitProcess Whether to invoke process.exit(0) upon completion (default: false for testability)
 */
export async function executeGracefulShutdown(
  signal = "SIGTERM",
  options: { timeoutMs?: number; exitProcess?: boolean } = {}
): Promise<{ success: boolean; executedHooks: string[]; errors: Record<string, string> }> {
  if (state.isShuttingDown) {
    console.warn(`[lifecycle] Shutdown already in progress. Signal ${signal} received again.`);
    return {
      success: false,
      executedHooks: [],
      errors: { lifecycle: "Shutdown already in progress" },
    };
  }

  state.isShuttingDown = true;
  state.signal = signal;
  state.startedAt = Date.now();

  const timeoutMs = options.timeoutMs ?? getShutdownTimeoutMs();
  const executedHooks: string[] = [];
  const errors: Record<string, string> = {};

  console.log(
    JSON.stringify({
      level: "info",
      event: "lifecycle:shutdown:start",
      signal,
      timeoutMs,
      timestamp: new Date().toISOString(),
      message: `[lifecycle] Initiating graceful shutdown on ${signal}. Grace period: ${timeoutMs}ms.`,
    })
  );

  // Sort hooks descending by priority (higher priority first)
  const sortedHooks = [...hooks].sort((a, b) => b.priority - a.priority);

  // Wrap execution in a timeout boundary
  const executeHooksPromise = (async () => {
    for (const hook of sortedHooks) {
      console.log(
        JSON.stringify({
          level: "info",
          event: "lifecycle:hook:executing",
          hook: hook.name,
          timestamp: new Date().toISOString(),
        })
      );
      try {
        await Promise.resolve(hook.fn());
        executedHooks.push(hook.name);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors[hook.name] = errorMsg;
        console.error(
          JSON.stringify({
            level: "error",
            event: "lifecycle:hook:error",
            hook: hook.name,
            error: errorMsg,
            timestamp: new Date().toISOString(),
          })
        );
      }
    }
  })();

  const timeoutPromise = new Promise<"TIMEOUT">((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    // Unref timer in Node environment so it doesn't prevent exit
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });

  const outcome = await Promise.race([
    executeHooksPromise.then(() => "COMPLETED" as const),
    timeoutPromise,
  ]);

  const durationMs = Date.now() - (state.startedAt ?? Date.now());
  const isTimeout = outcome === "TIMEOUT";

  if (isTimeout) {
    errors["lifecycle:timeout"] = `Shutdown timed out after ${timeoutMs}ms`;
    console.error(
      JSON.stringify({
        level: "error",
        event: "lifecycle:shutdown:timeout",
        durationMs,
        signal,
        timestamp: new Date().toISOString(),
        message: `[lifecycle] Graceful shutdown exceeded timeout of ${timeoutMs}ms. Forcing exit.`,
      })
    );
  } else {
    console.log(
      JSON.stringify({
        level: "info",
        event: "lifecycle:shutdown:complete",
        durationMs,
        executedHooks,
        signal,
        timestamp: new Date().toISOString(),
        message: `[lifecycle] Graceful shutdown completed cleanly in ${durationMs}ms.`,
      })
    );
  }

  const success = !isTimeout && Object.keys(errors).length === 0;

  if (options.exitProcess) {
    const exitCode = success ? 0 : 1;
    process.exit(exitCode);
  }

  return { success, executedHooks, errors };
}

/**
 * Setup SIGTERM and SIGINT listeners on the current Node.js process.
 * Safe for repeated calls and ignores execution in non-Node or test environments unless forced.
 */
export function setupSignalHandlers(options: { force?: boolean } = {}): void {
  if (signalHandlersInstalled) {
    return;
  }

  // Skip in browser/edge environments
  if (typeof process === "undefined" || !process.on) {
    return;
  }

  // In test environment or Next.js build, don't install auto-exit listeners unless explicitly forced
  if (!options.force && (process.env.NODE_ENV === "test" || process.env.NEXT_PHASE)) {
    return;
  }

  sigtermListener = () => {
    void executeGracefulShutdown("SIGTERM", { exitProcess: true });
  };

  sigintListener = () => {
    void executeGracefulShutdown("SIGINT", { exitProcess: true });
  };

  process.once("SIGTERM", sigtermListener);
  process.once("SIGINT", sigintListener);

  signalHandlersInstalled = true;
}

/**
 * Remove SIGTERM and SIGINT signal handlers.
 */
export function teardownSignalHandlers(): void {
  if (!signalHandlersInstalled) {
    return;
  }

  if (typeof process !== "undefined" && process.removeListener) {
    if (sigtermListener) {
      process.removeListener("SIGTERM", sigtermListener);
      sigtermListener = null;
    }
    if (sigintListener) {
      process.removeListener("SIGINT", sigintListener);
      sigintListener = null;
    }
  }

  signalHandlersInstalled = false;
}
