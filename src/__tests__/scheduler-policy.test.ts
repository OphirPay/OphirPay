// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  CRON_SECRET_HEADER,
  MAX_EXECUTION_ATTEMPTS,
  MAX_PAYMENTS_PER_RUN,
  PROCESSING_LEASE_MS,
  authorizeCronRequest,
  candidateWhere,
  claimWhere,
  isDue,
  isLeaseExpired,
  newRunId,
  readCronSecret,
  secretsMatch,
  selectDuePayments,
  type SchedulableRecord,
} from "@/lib/scheduler";

/**
 * Every case below drives a fixed, simulated clock — `NOW` is the instant the
 * run would have captured — so due-selection and lease expiry are exercised
 * without any dependency on real time.
 */
const NOW = new Date("2026-08-28T12:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function record(overrides: Partial<SchedulableRecord> = {}): SchedulableRecord {
  return {
    id: "sched-1",
    scheduledAt: at(-60_000),
    status: "SCHEDULED",
    lockedAt: null,
    attempts: 0,
    ...overrides,
  };
}

describe("isDue", () => {
  it("is due once the scheduled instant has passed", () => {
    expect(isDue(record({ scheduledAt: at(-1) }), NOW)).toBe(true);
  });

  it("is due exactly at the scheduled instant", () => {
    expect(isDue(record({ scheduledAt: NOW }), NOW)).toBe(true);
  });

  it("is not due one millisecond early", () => {
    expect(isDue(record({ scheduledAt: at(1) }), NOW)).toBe(false);
  });

  it("is not due once the attempt cap is reached", () => {
    expect(
      isDue(record({ attempts: MAX_EXECUTION_ATTEMPTS }), NOW)
    ).toBe(false);
  });

  it("leaves a PROCESSING row alone while its lease is live", () => {
    const claimed = record({
      status: "PROCESSING",
      lockedAt: at(-PROCESSING_LEASE_MS + 1_000),
    });
    expect(isDue(claimed, NOW)).toBe(false);
  });

  it("reclaims a PROCESSING row whose lease has expired", () => {
    const abandoned = record({
      status: "PROCESSING",
      lockedAt: at(-PROCESSING_LEASE_MS),
    });
    expect(isDue(abandoned, NOW)).toBe(true);
  });

  it("reclaims a PROCESSING row that carries no lease at all", () => {
    expect(isDue(record({ status: "PROCESSING", lockedAt: null }), NOW)).toBe(
      true
    );
  });

  it.each(["EXECUTED", "FAILED", "CANCELLED"])(
    "never re-runs a terminal row (%s)",
    (status) => {
      expect(isDue(record({ status }), NOW)).toBe(false);
    }
  );

  it("rejects an invalid clock", () => {
    expect(() => isDue(record(), new Date("nonsense"))).toThrow(TypeError);
  });

  it("rejects a record with an invalid scheduled date", () => {
    expect(() =>
      isDue(record({ scheduledAt: new Date("nonsense") }), NOW)
    ).toThrow(TypeError);
  });
});

describe("isLeaseExpired", () => {
  it("treats a missing lease as expired", () => {
    expect(isLeaseExpired(record({ lockedAt: null }), NOW)).toBe(true);
  });

  it("expires the lease exactly at the window boundary", () => {
    expect(
      isLeaseExpired(record({ lockedAt: at(-PROCESSING_LEASE_MS) }), NOW)
    ).toBe(true);
  });

  it("honours a custom lease window", () => {
    const row = record({ lockedAt: at(-30_000) });
    expect(isLeaseExpired(row, NOW, 60_000)).toBe(false);
    expect(isLeaseExpired(row, NOW, 10_000)).toBe(true);
  });
});

describe("selectDuePayments", () => {
  it("returns only due rows, oldest schedule first", () => {
    const rows = [
      record({ id: "c", scheduledAt: at(-1_000) }),
      record({ id: "a", scheduledAt: at(-60_000) }),
      record({ id: "future", scheduledAt: at(60_000) }),
      record({ id: "b", scheduledAt: at(-30_000) }),
    ];

    expect(selectDuePayments(rows, { now: NOW }).map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("breaks ties on id so concurrent runs walk the same order", () => {
    const rows = [
      record({ id: "z", scheduledAt: at(-1_000) }),
      record({ id: "a", scheduledAt: at(-1_000) }),
    ];

    expect(selectDuePayments(rows, { now: NOW }).map((r) => r.id)).toEqual([
      "a",
      "z",
    ]);
  });

  it("caps the batch at the requested limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      record({ id: `id-${i}`, scheduledAt: at(-i * 1_000) })
    );

    expect(selectDuePayments(rows, { now: NOW, limit: 3 })).toHaveLength(3);
  });

  it("defaults the limit to the per-run maximum", () => {
    const rows = Array.from({ length: MAX_PAYMENTS_PER_RUN + 5 }, (_, i) =>
      record({ id: `id-${i}`, scheduledAt: at(-1_000) })
    );

    expect(selectDuePayments(rows, { now: NOW })).toHaveLength(
      MAX_PAYMENTS_PER_RUN
    );
  });

  it("advancing the simulated clock brings later rows into the batch", () => {
    const rows = [
      record({ id: "soon", scheduledAt: at(30_000) }),
      record({ id: "later", scheduledAt: at(90_000) }),
    ];

    expect(selectDuePayments(rows, { now: NOW })).toEqual([]);
    expect(
      selectDuePayments(rows, { now: at(60_000) }).map((r) => r.id)
    ).toEqual(["soon"]);
    expect(
      selectDuePayments(rows, { now: at(120_000) }).map((r) => r.id)
    ).toEqual(["soon", "later"]);
  });

  it("skips rows another run holds a live lease on", () => {
    const rows = [
      record({ id: "held", status: "PROCESSING", lockedAt: at(-1_000) }),
      record({ id: "free" }),
    ];

    expect(selectDuePayments(rows, { now: NOW }).map((r) => r.id)).toEqual([
      "free",
    ]);
  });

  it("returns an empty batch when nothing is due", () => {
    expect(
      selectDuePayments([record({ scheduledAt: at(5_000) })], { now: NOW })
    ).toEqual([]);
  });

  it("rejects a non-positive limit", () => {
    expect(() => selectDuePayments([], { now: NOW, limit: 0 })).toThrow(
      RangeError
    );
    expect(() => selectDuePayments([], { now: NOW, limit: 1.5 })).toThrow(
      RangeError
    );
  });
});

describe("candidateWhere", () => {
  it("asks only for actionable rows that are already due", () => {
    expect(candidateWhere(NOW)).toEqual({
      status: { in: ["SCHEDULED", "PROCESSING"] },
      scheduledAt: { lte: NOW },
      attempts: { lt: MAX_EXECUTION_ATTEMPTS },
    });
  });

  it("rejects an invalid clock", () => {
    expect(() => candidateWhere(new Date("nonsense"))).toThrow(TypeError);
  });
});

describe("claimWhere", () => {
  it("only matches an unclaimed row or one with an expired lease", () => {
    const where = claimWhere("sched-1", NOW);

    expect(where.id).toBe("sched-1");
    expect(where.scheduledAt).toEqual({ lte: NOW });
    expect(where.attempts).toEqual({ lt: MAX_EXECUTION_ATTEMPTS });
    expect(where.OR[0]).toEqual({ status: "SCHEDULED" });
    expect(where.OR[1]).toEqual({
      status: "PROCESSING",
      OR: [
        { lockedAt: null },
        { lockedAt: { lte: new Date(NOW.getTime() - PROCESSING_LEASE_MS) } },
      ],
    });
  });

  it("moves the lease cutoff with the custom lease window", () => {
    const where = claimWhere("sched-1", NOW, 60_000);

    expect(where.OR[1]).toEqual({
      status: "PROCESSING",
      OR: [{ lockedAt: null }, { lockedAt: { lte: at(-60_000) } }],
    });
  });
});

describe("newRunId", () => {
  it("mints a distinct id per run", () => {
    expect(newRunId()).not.toBe(newRunId());
  });
});

describe("cron secret handling", () => {
  it("matches identical secrets and rejects different ones", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
    expect(secretsMatch("s3cret", "s3crey")).toBe(false);
  });

  it("compares secrets of differing length without throwing", () => {
    expect(secretsMatch("short", "a-much-longer-secret")).toBe(false);
  });

  it("reads the secret from an Authorization bearer header", () => {
    const headers = new Headers({ authorization: "Bearer top-secret" });
    expect(readCronSecret(headers)).toBe("top-secret");
  });

  it("accepts a lowercase bearer scheme", () => {
    const headers = new Headers({ authorization: "bearer top-secret" });
    expect(readCronSecret(headers)).toBe("top-secret");
  });

  it("falls back to the x-cron-secret header", () => {
    const headers = new Headers({ [CRON_SECRET_HEADER]: "top-secret" });
    expect(readCronSecret(headers)).toBe("top-secret");
  });

  it("ignores a non-bearer Authorization header", () => {
    const headers = new Headers({ authorization: "Basic abc123" });
    expect(readCronSecret(headers)).toBeNull();
  });

  it("returns null when no secret is presented", () => {
    expect(readCronSecret(new Headers())).toBeNull();
  });
});

describe("authorizeCronRequest", () => {
  it("authorizes a request carrying the configured secret", () => {
    const headers = new Headers({ authorization: "Bearer top-secret" });
    expect(authorizeCronRequest(headers, "top-secret")).toEqual({ ok: true });
  });

  it("reports missing configuration separately from a bad secret", () => {
    const headers = new Headers({ authorization: "Bearer top-secret" });
    expect(authorizeCronRequest(headers, undefined)).toEqual({
      ok: false,
      reason: "not-configured",
    });
  });

  it("rejects a wrong secret", () => {
    const headers = new Headers({ authorization: "Bearer wrong" });
    expect(authorizeCronRequest(headers, "top-secret")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("rejects a request with no secret at all", () => {
    expect(authorizeCronRequest(new Headers(), "top-secret")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});
