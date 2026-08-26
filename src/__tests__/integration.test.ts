// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { toCsvString, createCsvResponse } from "@/lib/export-csv";
import { hasSufficientBalance, xlmToStroops, stroopsToXlm, formatStellarKey } from "@/lib/stellar-helpers";
import { getStellarErrorMessage, isRecoverableStellarError } from "@/lib/stellar-error";
import { cacheControl, CACHE_PRESETS } from "@/lib/cache";
import { withTimeout, sleep } from "@/lib/timeout";

// ─── CSV export ─────────────────────────────────────────────────

describe("toCsvString", () => {
  it("generates CSV with header and rows", () => {
    const data = [
      { id: "1", name: "Alice", amount: 100 },
      { id: "2", name: "Bob", amount: 200 },
    ];
    const csv = toCsvString(data, [
      { key: "id", header: "ID" },
      { key: "name", header: "Name" },
      { key: "amount", header: "Amount" },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("ID,Name,Amount");
    expect(lines[1]).toBe("1,Alice,100");
    expect(lines[2]).toBe("2,Bob,200");
  });

  it("escapes commas in values", () => {
    const result = toCsvString(
      [{ name: "Doe, John" }],
      [{ key: "name", header: "Name" satisfies string }],
    );
    expect(result).toContain('"Doe, John"');
  });
});

describe("createCsvResponse", () => {
  it("returns a Response with CSV content type", () => {
    const res = createCsvResponse("export.csv", "a,b\n1,2");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("export.csv");
  });
});

// ─── Stellar helpers ────────────────────────────────────────────

describe("xlmToStroops / stroopsToXlm", () => {
  it("round-trips correctly", () => {
    expect(xlmToStroops(1.5)).toBe(15_000_000);
    expect(stroopsToXlm(15_000_000)).toBe("1.5000000");
  });

  it("handles zero", () => {
    expect(xlmToStroops(0)).toBe(0);
    expect(stroopsToXlm(0)).toBe("0.0000000");
  });
});

describe("hasSufficientBalance", () => {
  it("returns true when balance covers amount + reserve", () => {
    expect(hasSufficientBalance(100, 99)).toBe(true);
  });

  it("returns false when balance does not cover reserve", () => {
    expect(hasSufficientBalance(10, 10)).toBe(false);
  });
});

describe("formatStellarKey", () => {
  it("formats a valid Stellar address", () => {
    const key = "G" + "A".repeat(55);
    expect(formatStellarKey(key, 4)).toBe("GAAAA…AAAA");
  });

  it("returns 'Invalid Address' for bad input", () => {
    expect(formatStellarKey("bad")).toBe("Invalid Address");
    expect(formatStellarKey("")).toBe("Invalid Address");
  });
});

// ─── Stellar error messages ─────────────────────────────────────

describe("getStellarErrorMessage", () => {
  it("maps op_underfunded to readable message", () => {
    const msg = getStellarErrorMessage("op_underfunded");
    expect(msg).toContain("Insufficient funds");
  });

  it("falls back to the original code for unknowns", () => {
    const msg = getStellarErrorMessage("tx_weird_code");
    expect(msg).toContain("tx_weird_code");
  });
});

describe("isRecoverableStellarError", () => {
  it("identifies recoverable errors", () => {
    expect(isRecoverableStellarError("op_underfunded")).toBe(true);
    expect(isRecoverableStellarError("tx_insufficient_balance")).toBe(true);
  });

  it("identifies non-recoverable errors", () => {
    expect(isRecoverableStellarError("tx_bad_auth")).toBe(false);
  });
});

// ─── Cache control ──────────────────────────────────────────────

describe("cacheControl", () => {
  it("returns no-cache for maxAge=0", () => {
    expect(cacheControl({ maxAge: 0 })).toBe("no-cache, no-store, must-revalidate");
  });

  it("builds public cache header", () => {
    expect(cacheControl({ maxAge: 300, staleWhileRevalidate: 600 }))
      .toBe("public, max-age=300, stale-while-revalidate=600");
  });

  it("supports private and immutable", () => {
    expect(cacheControl({ maxAge: 3600, isPrivate: true, immutable: true }))
      .toBe("private, max-age=3600, immutable");
  });
});

describe("CACHE_PRESETS", () => {
  it("has dynamic preset as no-cache", () => {
    expect(CACHE_PRESETS.dynamic).toContain("no-cache");
  });

  it("has immutable preset with 1 year max-age", () => {
    expect(CACHE_PRESETS.immutable).toContain("31536000");
  });
});

// ─── Timeout / sleep ────────────────────────────────────────────

describe("withTimeout", () => {
  it("resolves when promise finishes in time", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("rejects when promise exceeds timeout", async () => {
    const slow = new Promise((r) => setTimeout(r, 500));
    await expect(withTimeout(slow, 10, "Too slow")).rejects.toThrow("Too slow");
  });
});

describe("sleep", () => {
  it("resolves after the given ms", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
