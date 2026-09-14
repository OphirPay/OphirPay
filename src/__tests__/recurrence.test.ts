// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { nextRunAt, frequencyLabel, FREQUENCY_LABELS } from "@/lib/recurrence";

describe("recurrence helpers", () => {
  it("computes the next daily run as +1 day", () => {
    const ref = new Date("2026-01-10T12:00:00.000Z");
    const next = nextRunAt(ref, "DAILY");
    expect(next.getUTCDate()).toBe(ref.getUTCDate() + 1);
  });

  it("computes the next weekly run as +7 days", () => {
    const ref = new Date("2026-01-10T12:00:00.000Z");
    expect(nextRunAt(ref, "WEEKLY").getTime()).toBe(ref.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it("computes the next biweekly run as +14 days", () => {
    const ref = new Date("2026-01-10T12:00:00.000Z");
    expect(nextRunAt(ref, "BIWEEKLY").getTime()).toBe(ref.getTime() + 14 * 24 * 60 * 60 * 1000);
  });

  it("computes the next monthly run as +1 month", () => {
    const ref = new Date("2026-01-15T12:00:00.000Z");
    const next = nextRunAt(ref, "MONTHLY");
    expect(next.getUTCMonth()).toBe(1);
  });

  it("computes the next quarterly run as +3 months", () => {
    const ref = new Date("2026-01-15T12:00:00.000Z");
    const next = nextRunAt(ref, "QUARTERLY");
    expect(next.getUTCMonth()).toBe(3);
  });

  it("computes the next yearly run as +1 year", () => {
    const ref = new Date("2026-01-15T12:00:00.000Z");
    const next = nextRunAt(ref, "YEARLY");
    expect(next.getUTCFullYear()).toBe(2027);
  });

  it("returns human labels for frequencies", () => {
    expect(frequencyLabel("DAILY")).toBe("Daily");
    expect(frequencyLabel("WEEKLY")).toBe("Weekly");
    expect(frequencyLabel("MONTHLY")).toBe("Monthly");
    expect(FREQUENCY_LABELS).toMatchObject({
      DAILY: "Daily",
      WEEKLY: "Weekly",
      BIWEEKLY: "Every 2 weeks",
      MONTHLY: "Monthly",
      QUARTERLY: "Quarterly",
      YEARLY: "Yearly",
    });
  });
});
