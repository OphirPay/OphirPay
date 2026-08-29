import { describe, expect, it } from "vitest";
import {
  SchedulerLockManager,
} from "../lib/scheduler-lock.js";

describe("SchedulerLockManager At-Most-Once Execution Guarantees", () => {
  it("generates deterministic deduplication keys", () => {
    const key = SchedulerLockManager.generateDedupeKey("pay_123", "sch_456", "2026-08-29T10:00:00Z");
    expect(key).toBe("scheduler_lock:pay_123:sch_456:2026-08-29T10:00:00Z");
  });

  it("grants exclusive execution lock to the first worker", async () => {
    const manager = new SchedulerLockManager({ leaseDurationMs: 5000 });
    const key = "test_key_1";

    const res1 = await manager.acquire(key, "worker_A");
    expect(res1.acquired).toBe(true);
    expect(res1.lockId).toBe("worker_A");

    // Second worker attempting concurrent acquisition is rejected
    const res2 = await manager.acquire(key, "worker_B");
    expect(res2.acquired).toBe(false);
    expect(res2.reason).toBe("LEASE_ACTIVE");

    const metrics = manager.getMetrics();
    expect(metrics.acquiredCount).toBe(1);
    expect(metrics.skippedActiveLeaseCount).toBe(1);
  });

  it("prevents rerun after completion", async () => {
    const manager = new SchedulerLockManager({ leaseDurationMs: 5000 });
    const key = "test_key_completed";

    await manager.acquire(key, "worker_A");
    const marked = await manager.markCompleted(key, "worker_A");
    expect(marked).toBe(true);

    // Any future attempts are rejected as ALREADY_COMPLETED
    const res = await manager.acquire(key, "worker_C");
    expect(res.acquired).toBe(false);
    expect(res.reason).toBe("ALREADY_COMPLETED");

    expect(manager.getMetrics().skippedAlreadyCompletedCount).toBe(1);
  });

  it("reclaims lock after lease expiry when worker hangs", async () => {
    let mockTime = 10000;
    const manager = new SchedulerLockManager({
      leaseDurationMs: 5000,
      now: () => mockTime,
    });
    const key = "test_key_expired";

    // Worker A acquires at t=10000, expires at t=15000
    await manager.acquire(key, "worker_A");

    // Advance clock past lease expiry
    mockTime = 16000;

    // Worker B should successfully reclaim expired lease
    const res2 = await manager.acquire(key, "worker_B");
    expect(res2.acquired).toBe(true);
    expect(res2.lockId).toBe("worker_B");

    expect(manager.getMetrics().expiredLeaseReclaimedCount).toBe(1);
  });

  it("allows early release on task failure for retry", async () => {
    const manager = new SchedulerLockManager();
    const key = "test_key_release";

    await manager.acquire(key, "worker_A");
    await manager.release(key, "worker_A");

    // Can be immediately re-acquired
    const res = await manager.acquire(key, "worker_B");
    expect(res.acquired).toBe(true);
    expect(res.lockId).toBe("worker_B");
  });

  it("handles massive concurrent race conditions with exactly one winner", async () => {
    const manager = new SchedulerLockManager({ leaseDurationMs: 10000 });
    const key = "test_race_condition";

    // Simulate 10 workers simultaneously trying to acquire the same lock
    const workers = Array.from({ length: 10 }, (_, i) => `worker_${i}`);
    const results = await Promise.all(
      workers.map((w) => manager.acquire(key, w))
    );

    const winners = results.filter((r) => r.acquired);
    const losers = results.filter((r) => !r.acquired);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);
    expect(losers.every((l) => l.reason === "LEASE_ACTIVE")).toBe(true);
  });
});
