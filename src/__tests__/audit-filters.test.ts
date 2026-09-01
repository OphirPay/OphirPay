// SPDX-License-Identifier: MIT
// Tests for audit-log client-side filtering + server export param mapping.

import { describe, it, expect } from "vitest";
import {
  distinctActions,
  filterEntries,
  serverExportParams,
  type AuditEntry,
} from "@/lib/audit-filters";

const E = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  timestamp: 1788100000,
  action: "payment_recorded",
  actor: "GAAA",
  target_id: 0,
  details: "recorded payment",
  ...over,
});

const ENTRIES: AuditEntry[] = [
  E({ id: 1, timestamp: 1788000000, action: "payment_recorded", details: "payment of 50 XLM" }),
  E({ id: 2, timestamp: 1788100000, action: "escrow_created", details: "escrow #7 opened" }),
  E({ id: 3, timestamp: 1788200000, action: "payment_cancelled", details: "Payment reverted by owner" }),
];

describe("audit-filters > distinctActions", () => {
  it("returns sorted unique action names", () => {
    expect(distinctActions(ENTRIES)).toEqual([
      "escrow_created",
      "payment_cancelled",
      "payment_recorded",
    ]);
  });
});

describe("audit-filters > filterEntries", () => {
  it("filters by exact action", () => {
    expect(filterEntries(ENTRIES, { text: "", action: "escrow_created" })).toHaveLength(1);
  });
  it("text filter matches action or details case-insensitively", () => {
    expect(filterEntries(ENTRIES, { text: "PAYMENT", action: "" })).toHaveLength(2);
    expect(filterEntries(ENTRIES, { text: "escrow #7", action: "" })).toHaveLength(1);
  });
  it("date range bounds are inclusive unix-second comparisons", () => {
    expect(
      filterEntries(ENTRIES, { text: "", action: "", from: "2026-08-30T00:00", to: "" }),
    ).toHaveLength(2);
    expect(
      filterEntries(ENTRIES, { text: "", action: "", from: "", to: "2026-08-30T00:00" }),
    ).toHaveLength(1);
  });
  it("combines all filters with AND semantics", () => {
    expect(
      filterEntries(ENTRIES, { text: "reverted", action: "payment_cancelled", from: "2026-08-30T00:00", to: "" }),
    ).toHaveLength(1);
    expect(
      filterEntries(ENTRIES, { text: "reverted", action: "escrow_created", from: "", to: "" }),
    ).toHaveLength(0);
  });
});

describe("audit-filters > serverExportParams", () => {
  it("maps UI filters to the server export schema", () => {
    const p = serverExportParams({
      text: "ignored client-side",
      action: "payment_recorded",
      from: "2026-08-30T00:00",
      to: "2026-08-31T00:00",
    });
    expect(p.get("action")).toBe("payment_recorded");
    expect(p.get("since")).toBe(new Date("2026-08-30T00:00").toISOString());
    expect(p.get("until")).toBe(new Date("2026-08-31T00:00").toISOString());
    expect(p.has("text")).toBe(false);
  });
  it("omits empty filters", () => {
    expect([...serverExportParams({ text: "", action: "", from: "", to: "" }).keys()]).toEqual([]);
  });
});
