// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest";
import type { Frequency } from "@prisma/client";

import { nextRunAfter } from "@/lib/recurring-scheduler";

// The module imports the Prisma client at load time; the interval math under
// test is pure, so keep the database out of it.
vi.mock("@/lib/prisma", () => ({ default: {} }));

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString();
const utc = (s: string) => new Date(s);

// ═══════════════════════════════════════════════════════════════
// DAILY
// ═══════════════════════════════════════════════════════════════

describe("nextRunAfter — DAILY", () => {
  it("adds exactly 86400 seconds", () => {
    const ref = utc("2026-08-29T12:34:56.789Z");
    const next = nextRunAfter(ref, "DAILY");
    expect(next.getTime() - ref.getTime()).toBe(86_400 * 1000);
  });

  it("crosses a month boundary", () => {
    expect(iso(nextRunAfter(utc("2026-01-31T23:59:59.000Z"), "DAILY"))).toBe(
      "2026-02-01T23:59:59.000Z",
    );
    expect(iso(nextRunAfter(utc("2026-04-30T08:00:00.000Z"), "DAILY"))).toBe(
      "2026-05-01T08:00:00.000Z",
    );
  });

  it("crosses a year boundary", () => {
    expect(iso(nextRunAfter(utc("2026-12-31T00:00:00.000Z"), "DAILY"))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("handles the leap day", () => {
    expect(iso(nextRunAfter(utc("2028-02-28T10:00:00.000Z"), "DAILY"))).toBe(
      "2028-02-29T10:00:00.000Z",
    );
    expect(iso(nextRunAfter(utc("2028-02-29T10:00:00.000Z"), "DAILY"))).toBe(
      "2028-03-01T10:00:00.000Z",
    );
    // Non-leap year skips straight to March.
    expect(iso(nextRunAfter(utc("2026-02-28T10:00:00.000Z"), "DAILY"))).toBe(
      "2026-03-01T10:00:00.000Z",
    );
  });

  it("is unaffected by DST transitions (UTC arithmetic)", () => {
    // US spring-forward day.
    const ref = utc("2026-03-08T00:00:00.000Z");
    expect(nextRunAfter(ref, "DAILY").getTime() - ref.getTime()).toBe(DAY_MS);
  });

  it("does not drift over 90 consecutive runs", () => {
    const start = utc("2026-01-01T09:15:00.000Z");
    let cur = start;
    for (let i = 0; i < 90; i++) cur = nextRunAfter(cur, "DAILY");
    expect(cur.getTime() - start.getTime()).toBe(90 * DAY_MS);
  });
});

// ═══════════════════════════════════════════════════════════════
// WEEKLY / BIWEEKLY
// ═══════════════════════════════════════════════════════════════

describe("nextRunAfter — WEEKLY", () => {
  it("adds exactly seven days", () => {
    const ref = utc("2026-08-29T12:00:00.000Z");
    expect(nextRunAfter(ref, "WEEKLY").getTime() - ref.getTime()).toBe(
      7 * DAY_MS,
    );
  });

  it("keeps the same day of week for every starting weekday", () => {
    // 14 consecutive days covers every weekday twice.
    for (let i = 0; i < 14; i++) {
      const ref = new Date(Date.UTC(2026, 7, 24 + i, 6, 30));
      expect(nextRunAfter(ref, "WEEKLY").getUTCDay()).toBe(ref.getUTCDay());
    }
  });

  it("crosses a month boundary", () => {
    expect(iso(nextRunAfter(utc("2026-02-26T12:00:00.000Z"), "WEEKLY"))).toBe(
      "2026-03-05T12:00:00.000Z",
    );
  });

  it("crosses a year boundary and stays on the same weekday", () => {
    const ref = utc("2026-12-28T12:00:00.000Z"); // Monday
    const next = nextRunAfter(ref, "WEEKLY");
    expect(iso(next)).toBe("2027-01-04T12:00:00.000Z");
    expect(next.getUTCDay()).toBe(1);
  });

  it("does not drift over 52 consecutive runs", () => {
    const start = utc("2026-01-05T09:00:00.000Z");
    let cur = start;
    for (let i = 0; i < 52; i++) cur = nextRunAfter(cur, "WEEKLY");
    expect(cur.getTime() - start.getTime()).toBe(52 * 7 * DAY_MS);
    expect(cur.getUTCDay()).toBe(start.getUTCDay());
  });
});

describe("nextRunAfter — BIWEEKLY", () => {
  it("adds exactly fourteen days, across a month boundary", () => {
    const ref = utc("2026-02-20T12:00:00.000Z");
    const next = nextRunAfter(ref, "BIWEEKLY");
    expect(iso(next)).toBe("2026-03-06T12:00:00.000Z");
    expect(next.getTime() - ref.getTime()).toBe(14 * DAY_MS);
  });
});

// ═══════════════════════════════════════════════════════════════
// MONTHLY
// ═══════════════════════════════════════════════════════════════

describe("nextRunAfter — MONTHLY", () => {
  it("keeps the day-of-month and time when the target month has it", () => {
    expect(iso(nextRunAfter(utc("2026-01-15T08:30:00.000Z"), "MONTHLY"))).toBe(
      "2026-02-15T08:30:00.000Z",
    );
  });

  it("crosses a year boundary", () => {
    expect(iso(nextRunAfter(utc("2026-12-15T08:30:00.000Z"), "MONTHLY"))).toBe(
      "2027-01-15T08:30:00.000Z",
    );
    expect(iso(nextRunAfter(utc("2026-12-31T08:30:00.000Z"), "MONTHLY"))).toBe(
      "2027-01-31T08:30:00.000Z",
    );
  });

  // Current behaviour: a 31st that does not exist in the next month overflows
  // into the following month (JS Date semantics) rather than clamping to the
  // last day. The result is always a valid date strictly in the future.
  describe("on the 31st rolls over into the following month", () => {
    it("Jan 31 → Mar 3 (non-leap February has 28 days)", () => {
      expect(
        iso(nextRunAfter(utc("2026-01-31T12:00:00.000Z"), "MONTHLY")),
      ).toBe("2026-03-03T12:00:00.000Z");
    });

    it("Jan 31 → Mar 2 (leap-year February has 29 days)", () => {
      expect(
        iso(nextRunAfter(utc("2028-01-31T12:00:00.000Z"), "MONTHLY")),
      ).toBe("2028-03-02T12:00:00.000Z");
    });

    it("Mar 31 → May 1 (April has 30 days)", () => {
      expect(
        iso(nextRunAfter(utc("2026-03-31T12:00:00.000Z"), "MONTHLY")),
      ).toBe("2026-05-01T12:00:00.000Z");
    });

    it("Oct 31 → Dec 1 (November has 30 days)", () => {
      expect(
        iso(nextRunAfter(utc("2026-10-31T12:00:00.000Z"), "MONTHLY")),
      ).toBe("2026-12-01T12:00:00.000Z");
    });
  });

  it("always yields a valid date 28–31 days after any day of a normal and a leap year", () => {
    for (const year of [2026, 2028]) {
      const cursor = new Date(Date.UTC(year, 0, 1, 12));
      while (cursor.getUTCFullYear() === year) {
        const next = nextRunAfter(cursor, "MONTHLY");
        const days = (next.getTime() - cursor.getTime()) / DAY_MS;

        expect(Number.isNaN(next.getTime())).toBe(false);
        expect(days).toBeGreaterThanOrEqual(28);
        expect(days).toBeLessThanOrEqual(31);

        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Shared contract
// ═══════════════════════════════════════════════════════════════

describe("nextRunAfter — contract", () => {
  it("does not mutate the reference date", () => {
    const ref = utc("2026-08-29T12:00:00.000Z");
    const before = ref.getTime();
    for (const f of ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"] as const) {
      nextRunAfter(ref, f);
    }
    expect(ref.getTime()).toBe(before);
  });

  it("preserves the time of day, including milliseconds", () => {
    const ref = utc("2026-08-29T23:59:59.999Z");
    for (const f of ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"] as const) {
      const next = nextRunAfter(ref, f);
      expect(next.getUTCHours()).toBe(23);
      expect(next.getUTCMinutes()).toBe(59);
      expect(next.getUTCSeconds()).toBe(59);
      expect(next.getUTCMilliseconds()).toBe(999);
    }
  });

  it("throws on an unknown frequency", () => {
    expect(() =>
      nextRunAfter(utc("2026-08-29T12:00:00.000Z"), "HOURLY" as Frequency),
    ).toThrow(/Unsupported frequency/);
  });
});
