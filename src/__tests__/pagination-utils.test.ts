// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  buildCursorWhere,
  computeNextCursor,
} from "@/lib/pagination-utils";

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor", () => {
    const cursor = { createdAt: "2026-08-01T12:00:00.000Z", id: "clx123456789" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("produces an opaque, URL-safe string without padding", () => {
    const raw = encodeCursor({
      createdAt: "2026-08-01T12:00:00.000Z",
      id: "clx123456789",
    });
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
    expect(raw).not.toContain("=");
    expect(raw).not.toContain(":");
  });

  it("returns null for malformed cursors", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor("aGVsbG8=")).toBeNull(); // valid base64, not JSON
    expect(decodeCursor(encodeCursor({ createdAt: "x", id: "" }))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("buildCursorWhere", () => {
  it("returns the base where untouched when there is no cursor", () => {
    const base = { userId: "u1", status: "COMPLETED" };
    expect(buildCursorWhere(base, null)).toBe(base);
  });

  it("combines the base filter with a keyset OR via AND", () => {
    const base = {
      userId: "u1",
      OR: [{ description: { contains: "invoice" } }],
    };
    const where = buildCursorWhere(base, {
      createdAt: "2026-08-01T00:00:00.000Z",
      id: "clx123",
    });
    expect(where).toEqual({
      AND: [
        base,
        {
          OR: [
            { createdAt: { lt: "2026-08-01T00:00:00.000Z" } },
            { createdAt: "2026-08-01T00:00:00.000Z", id: { lt: "clx123" } },
          ],
        },
      ],
    });
    // The base filter's own OR must not be clobbered by the keyset OR.
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and[0].OR).toBeDefined();
  });
});

describe("computeNextCursor", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: `row-${i}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  }));

  it("returns a cursor for the boundary row when more rows exist", () => {
    const { nextCursor, hasMore } = computeNextCursor(rows, 50);
    expect(hasMore).toBe(true);
    expect(nextCursor).not.toBeNull();
    // The boundary is the 50th row (index 49), NOT the extra fetched row.
    const boundary = decodeCursor(nextCursor as string);
    expect(boundary).toEqual({
      createdAt: "2026-01-01T00:00:49.000Z",
      id: "row-49",
    });
  });

  it("reports the end of the list when at most limit rows came back", () => {
    expect(computeNextCursor(rows, 60)).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(computeNextCursor(rows, 100)).toEqual({
      nextCursor: null,
      hasMore: false,
    });
  });

  it("handles Date and string createdAt values", () => {
    const withStrings = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
    const { nextCursor } = computeNextCursor(withStrings, 50);
    expect(decodeCursor(nextCursor as string)?.createdAt).toBe(
      "2026-01-01T00:00:49.000Z"
    );
  });
});
