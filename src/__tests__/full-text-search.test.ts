// SPDX-License-Identifier: MIT
//
// Tests for PostgreSQL full-text search utilities, tokenization,
// prefix matching, hash prioritization, and SQLite fallbacks (Issue #823).

import { describe, it, expect } from "vitest";
import {
  tokenize,
  buildTsQuery,
  looksLikeTxHash,
  normalizeTxHash,
  escapeLikePattern,
  buildFallbackWhere,
  buildAuditLogFallbackWhere,
  buildPostgresRankExpression,
  buildPostgresMatchExpression,
} from "@/lib/full-text-search";

describe("full-text-search — tokenize", () => {
  it("extracts clean word tokens from simple text", () => {
    expect(tokenize("invoice payment")).toEqual(["invoice", "payment"]);
  });

  it("strips special tsquery operators safely", () => {
    expect(tokenize("foo & bar | !baz (qux):*")).toEqual(["foo", "bar", "baz", "qux"]);
  });

  it("strips quotes and backslashes without error", () => {
    expect(tokenize(`'invoice' "memo\\test"`)).toEqual(["invoice", "memo", "test"]);
  });

  it("returns empty array for empty or whitespace query", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("  & | ! : *  ")).toEqual([]);
  });
});

describe("full-text-search — buildTsQuery", () => {
  it("formats single token with prefix-matching syntax", () => {
    expect(buildTsQuery("invoice")).toBe("'invoice':*");
  });

  it("formats multiple tokens joined with & operator for AND semantics", () => {
    expect(buildTsQuery("stellar invoice payment")).toBe(
      "'stellar':* & 'invoice':* & 'payment':*"
    );
  });

  it("supports partial word terms (e.g. inv matches invoice)", () => {
    expect(buildTsQuery("inv")).toBe("'inv':*");
  });

  it("returns empty string for empty or symbol-only inputs", () => {
    expect(buildTsQuery("")).toBe("");
    expect(buildTsQuery("! & *")).toBe("");
  });
});

describe("full-text-search — looksLikeTxHash & normalizeTxHash", () => {
  const VALID_HASH = "a".repeat(64);
  const MIXED_HASH = "0123456789abcdef".repeat(4);

  it("identifies valid 64-character hexadecimal hashes", () => {
    expect(looksLikeTxHash(VALID_HASH)).toBe(true);
    expect(looksLikeTxHash(MIXED_HASH)).toBe(true);
  });

  it("rejects non-hex or invalid length strings", () => {
    expect(looksLikeTxHash("not-a-hash")).toBe(false);
    expect(looksLikeTxHash("a".repeat(63))).toBe(false);
    expect(looksLikeTxHash("a".repeat(65))).toBe(false);
    expect(looksLikeTxHash("g".repeat(64))).toBe(false);
    expect(looksLikeTxHash("")).toBe(false);
  });

  it("normalizes hash by trimming whitespace", () => {
    expect(normalizeTxHash(`  ${VALID_HASH}  `)).toBe(VALID_HASH);
  });
});

describe("full-text-search — escapeLikePattern", () => {
  it("escapes %, _, and backslash for safe ILIKE queries", () => {
    expect(escapeLikePattern("100%_done\\")).toBe("100\\%\\_done\\\\");
  });

  it("leaves normal alphanumeric characters untouched", () => {
    expect(escapeLikePattern("hello world 123")).toBe("hello world 123");
  });
});

describe("full-text-search — fallback queries (SQLite compatibility)", () => {
  it("buildFallbackWhere returns memo ILIKE, description substring, and exact txHash", () => {
    const fallback = buildFallbackWhere("invoice");
    expect(fallback).toEqual([
      { description: { contains: "invoice" } },
      { memo: { contains: "invoice", mode: "insensitive" } },
      { transactionHash: { equals: "invoice" } },
    ]);
  });

  it("buildFallbackWhere returns undefined for empty query", () => {
    expect(buildFallbackWhere("")).toBeUndefined();
    expect(buildFallbackWhere("   ")).toBeUndefined();
  });

  it("buildAuditLogFallbackWhere returns actor and action case-insensitive substring matches", () => {
    const fallback = buildAuditLogFallbackWhere("admin");
    expect(fallback).toEqual([
      { actor: { contains: "admin", mode: "insensitive" } },
      { action: { contains: "admin", mode: "insensitive" } },
    ]);
  });

  it("buildAuditLogFallbackWhere returns undefined for empty query", () => {
    expect(buildAuditLogFallbackWhere("")).toBeUndefined();
    expect(buildAuditLogFallbackWhere("   ")).toBeUndefined();
  });
});

describe("full-text-search — PostgreSQL rank and match expressions", () => {
  it("builds rank expression with exact hash priority boost when hash provided", () => {
    const expr = buildPostgresRankExpression("searchVector", "$1", "$2");
    expect(expr).toBe(
      `CASE WHEN "transactionHash" = $2 THEN 1000.0 ELSE ts_rank("searchVector", to_tsquery('english', $1)) END`
    );
  });

  it("builds rank expression without hash boost when hash omitted", () => {
    const expr = buildPostgresRankExpression("searchVector", "$1");
    expect(expr).toBe(`ts_rank("searchVector", to_tsquery('english', $1))`);
  });

  it("builds match expression combining @@ tsquery with exact hash check", () => {
    const expr = buildPostgresMatchExpression("searchVector", "$1", "$2");
    expect(expr).toBe(
      `("searchVector" @@ to_tsquery('english', $1) OR "transactionHash" = $2)`
    );
  });

  it("builds match expression without hash check", () => {
    const expr = buildPostgresMatchExpression("searchVector", "$1");
    expect(expr).toBe(`"searchVector" @@ to_tsquery('english', $1)`);
  });
});
