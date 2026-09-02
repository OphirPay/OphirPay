// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  parseAuditTimestamp,
  auditLogQuerySchema,
  toAuditLogFilters,
  normalizeAuditEntry,
  matchesAuditFilters,
  escapeCsvField,
  auditEntryToCsvRow,
  buildAuditExportFilename,
  type AuditLogEntry,
} from "@/lib/audit-log";

const entry = (overrides: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 3,
  timestamp: 1785168000,
  action: "payment_recorded",
  actor: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
  target_id: 42,
  details: "Payment 42: 25.5 XLM",
  ...overrides,
});

describe("parseAuditTimestamp", () => {
  it("treats a bare integer as Unix seconds", () => {
    expect(parseAuditTimestamp("1785168000")).toBe(1785168000);
  });

  it("parses ISO 8601 dates to whole seconds", () => {
    expect(parseAuditTimestamp("2026-07-27T00:00:00.000Z")).toBe(1785110400);
    expect(parseAuditTimestamp("2026-07-27T00:00:00Z")).toBe(1785110400);
  });

  it("trims surrounding whitespace", () => {
    expect(parseAuditTimestamp("  1785168000  ")).toBe(1785168000);
  });

  it("returns null for unparseable input", () => {
    expect(parseAuditTimestamp("not-a-date")).toBeNull();
    expect(parseAuditTimestamp("999999999999999999999")).toBeNull();
  });
});

describe("auditLogQuerySchema", () => {
  it("applies defaults for page/limit/order", () => {
    const parsed = auditLogQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    const q = parsed.data!;
    expect(q.page).toBe(1);
    expect(q.limit).toBe(20);
    expect(q.order).toBe("desc");
  });

  it("validates combined filters", () => {
    const parsed = auditLogQuerySchema.safeParse({
      page: "2",
      limit: "50",
      actor: entry().actor,
      action: "payment_recorded",
      resource: "42",
      since: "2026-07-26T00:00:00Z",
      until: "1785340800",
      order: "asc",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects until < since", () => {
    const parsed = auditLogQuerySchema.safeParse({
      since: "1785331200",
      until: "1785168000",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a limit above 100", () => {
    const parsed = auditLogQuerySchema.safeParse({ limit: "101" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid date range value", () => {
    const parsed = auditLogQuerySchema.safeParse({ since: "yesterday" });
    expect(parsed.success).toBe(false);
  });
});

describe("toAuditLogFilters", () => {
  it("converts validated query params to numeric filters", () => {
    const parsed = auditLogQuerySchema.safeParse({
      actor: entry().actor,
      action: "escrow_created",
      resource: "5",
      since: "2026-07-27T00:00:00Z",
      until: "1785168000",
      order: "asc",
    });
    expect(parsed.success).toBe(true);
    const filters = toAuditLogFilters(parsed.data!);

    expect(filters.actor).toBe(entry().actor);
    expect(filters.action).toBe("escrow_created");
    expect(filters.resource).toBe(5);
    expect(filters.since).toBe(1785110400);
    expect(filters.until).toBe(1785168000);
    expect(filters.order).toBe("asc");
  });

  it("omits unset filters", () => {
    const parsed = auditLogQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    const filters = toAuditLogFilters(parsed.data!);
    expect(filters.actor).toBeUndefined();
    expect(filters.action).toBeUndefined();
    expect(filters.resource).toBeUndefined();
    expect(filters.since).toBeUndefined();
    expect(filters.until).toBeUndefined();
  });
});

describe("normalizeAuditEntry", () => {
  it("converts BigInt fields to numbers", () => {
    const raw = {
      id: BigInt(3),
      timestamp: BigInt(1785168000),
      action: "payment_recorded",
      actor: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      target_id: BigInt(42),
      details: "Payment 42: 25.5 XLM",
    } as unknown;
    expect(normalizeAuditEntry(raw)).toEqual(entry());
  });

  it("returns null for non-entry values", () => {
    expect(normalizeAuditEntry(null)).toBeNull();
    expect(normalizeAuditEntry(undefined)).toBeNull();
    expect(normalizeAuditEntry("nope")).toBeNull();
  });
});

describe("matchesAuditFilters", () => {
  const base = entry();

  it("matches when no filters are set", () => {
    expect(matchesAuditFilters(base, {})).toBe(true);
  });

  it("applies actor, action, and resource (AND semantics)", () => {
    expect(
      matchesAuditFilters(base, {
        actor: base.actor,
        action: base.action,
        resource: base.target_id,
      })
    ).toBe(true);

    expect(
      matchesAuditFilters(base, { actor: "GDHJ3K2LQ7F5XQZPX6YWNMYKXWQXVZKBJZQFYX3F6KRLV4WDXHJMB2UY" })
    ).toBe(false);
    expect(matchesAuditFilters(base, { action: "escrow_created" })).toBe(false);
    expect(matchesAuditFilters(base, { resource: base.target_id + 1 })).toBe(false);
  });

  it("applies inclusive since/until date range on the epoch timestamp", () => {
    expect(matchesAuditFilters(base, { since: base.timestamp })).toBe(true);
    expect(matchesAuditFilters(base, { since: base.timestamp + 1 })).toBe(false);
    expect(matchesAuditFilters(base, { until: base.timestamp })).toBe(true);
    expect(matchesAuditFilters(base, { until: base.timestamp - 1 })).toBe(false);
  });
});

describe("CSV helpers", () => {
  it("quotes fields containing commas, quotes, or line breaks", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField('says "hi", ok')).toBe('"says ""hi"", ok"');
    expect(escapeCsvField("a\r\nb")).toBe('"a\r\nb"');
  });

  it("escapes actor addresses with commas", () => {
    const actor = "GC5QHJ2KJ7E6XW9Y3B4N8M1P2Q7R5T9U1V3W6X8Y2Z4A7C9D1E3F5G7H9,";
    const row = auditEntryToCsvRow(entry({ actor, details: "has,comma" }));
    expect(row).toContain(`"${actor}"`);
    expect(row).toContain('"has,comma"');
  });

  it("renders a stable header + data row", () => {
    const row = auditEntryToCsvRow(entry());
    expect(row).toBe(
      `${entry().id},${entry().timestamp},payment_recorded,${entry().actor},42,Payment 42: 25.5 XLM`
    );
  });
});

describe("buildAuditExportFilename", () => {
  it("builds a dated UTC filename", () => {
    const now = new Date("2026-08-26T10:15:30.000Z");
    expect(buildAuditExportFilename(now)).toBe(
      "ophirpay-audit-log-2026-08-26.csv"
    );
  });
});