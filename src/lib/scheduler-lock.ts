/**
 * Distributed lease-based scheduler lock with idempotency and deduplication guarantees.
 * Ensures at-most-once execution of scheduled payment runs across distributed instances.
 */

export interface SchedulerLockOptions {
  /** Lease expiration window in milliseconds. Defaults to 30,000ms (30s). */
  leaseDurationMs?: number;
  /** Custom clock function for deterministic testing. */
  now?: () => number;
}

export interface LockAcquisitionResult {
  acquired: boolean;
  lockId?: string;
  leaseExpiresAt?: number;
  reason?: "ALREADY_LOCKED" | "ALREADY_COMPLETED" | "LEASE_ACTIVE";
}

export interface ExecutionMetrics {
  acquiredCount: number;
  skippedActiveLeaseCount: number;
  skippedAlreadyCompletedCount: number;
  releasedCount: number;
  expiredLeaseReclaimedCount: number;
}

export class SchedulerLockManager {
  private readonly leaseDurationMs: number;
  private readonly now: () => number;

  private readonly locks = new Map<
    string,
    { lockId: string; expiresAt: number; completed: boolean }
  >();

  private readonly metrics: ExecutionMetrics = {
    acquiredCount: 0,
    skippedActiveLeaseCount: 0,
    skippedAlreadyCompletedCount: 0,
    releasedCount: 0,
    expiredLeaseReclaimedCount: 0,
  };

  public constructor(options?: SchedulerLockOptions) {
    this.leaseDurationMs = options?.leaseDurationMs ?? 30_000;
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Generates a deterministic deduplication key for a scheduled payment execution.
   */
  public static generateDedupeKey(
    paymentId: string,
    scheduleId: string,
    runTimestampOrSequence: string | number
  ): string {
    return `scheduler_lock:${paymentId}:${scheduleId}:${runTimestampOrSequence}`;
  }

  /**
   * Attempts to acquire an exclusive execution lease for the given dedupe key.
   */
  public async acquire(
    dedupeKey: string,
    workerId: string
  ): Promise<LockAcquisitionResult> {
    const currentTime = this.now();
    const existing = this.locks.get(dedupeKey);

    if (existing) {
      if (existing.completed) {
        this.metrics.skippedAlreadyCompletedCount++;
        return {
          acquired: false,
          reason: "ALREADY_COMPLETED",
        };
      }

      if (currentTime < existing.expiresAt) {
        this.metrics.skippedActiveLeaseCount++;
        return {
          acquired: false,
          reason: "LEASE_ACTIVE",
          leaseExpiresAt: existing.expiresAt,
        };
      }

      // Existing lease expired; reclaim lock
      this.metrics.expiredLeaseReclaimedCount++;
    }

    const expiresAt = currentTime + this.leaseDurationMs;
    this.locks.set(dedupeKey, {
      lockId: workerId,
      expiresAt,
      completed: false,
    });

    this.metrics.acquiredCount++;
    return {
      acquired: true,
      lockId: workerId,
      leaseExpiresAt: expiresAt,
    };
  }

  /**
   * Marks a scheduled payment run as successfully completed, preventing future reruns.
   */
  public async markCompleted(
    dedupeKey: string,
    workerId: string
  ): Promise<boolean> {
    const entry = this.locks.get(dedupeKey);
    if (!entry || entry.lockId !== workerId) {
      return false;
    }

    entry.completed = true;
    return true;
  }

  /**
   * Releases a lease early in case of graceful task failure or cancellation.
   */
  public async release(dedupeKey: string, workerId: string): Promise<boolean> {
    const entry = this.locks.get(dedupeKey);
    if (!entry || entry.lockId !== workerId) {
      return false;
    }

    if (!entry.completed) {
      this.locks.delete(dedupeKey);
      this.metrics.releasedCount++;
    }
    return true;
  }

  /**
   * Returns current execution metrics for monitoring and alerts.
   */
  public getMetrics(): Readonly<ExecutionMetrics> {
    return { ...this.metrics };
  }
}
