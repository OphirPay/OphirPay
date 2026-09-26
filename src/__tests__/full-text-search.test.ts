// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  tokenize,
  buildTsQuery,
  looksLikeTxHash,
  normalizeTxHash,
  escapeLikePattern,
  buildPostgresMatch,
  buildPostgresRank,
  buildFallbackWhere,
  SEARCH_VECTOR_COLUMN,
} from "@/lib/full-text-search";

/**
 * Unit tests for the Postgres full-text search helpers (issue #823). They are
 * all pure functions, so no database is required.
 */
describe("tokenize", () => {
  it("splits on punctuation and whitespace", () => {
    expect(tokenize("invoice, paid!")).toEqual(["invoice", "paid"]);
  });

  it("strips tsquery operators so input cannot change the query shape", () => {
    expect(tokenize("a & b | !c")).toEqual(["a", "b", "c"]);
  });

  it("keeps underscores inside identifiers and drops empty terms", () => {
    expect(tokenize("tx_hash_123")).toEqual(["tx_hash_123"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("buildTsQuery", () => {
  it("ANDs multiple terms and prefix-matches the last one", () => {
    expect(buildTsQuery("invoice paid")).toBe("invoice & paid:*");
  });

  it("omits the prefix operator when disabled", () => {
    expect(buildTsQuery("alpha beta", { prefix: false })).toBe("alpha & beta");
  });

  it("returns null when there is nothing to search for", () => {
    expect(buildTsQuery("  ")).toBeNull();
    expect(buildTsQuery("&|!")).toBeNull();
  });
});

describe("normalizeTxHash / looksLikeTxHash", () => {
  it("normalises a 0x-prefixed hash to the stored form", () => {
    expect(normalizeTxHash("0xABC123")).toBe("ABC123");
    expect(normalizeTxHash("  deadbeef  ")).toBe("deadbeef");
  });

  it("recognises hex hashes with or without a 0x prefix", () => {
    const hash = "a".repeat(64);
    expect(looksLikeTxHash(hash)).toBe(true);
    expect(looksLikeTxHash(`0x${hash}`)).toBe(true);
    expect(looksLikeTxHash("invoice")).toBe(false);
  });
});

describe("escapeLikePattern", () => {
  it("escapes ILIKE wildcards and the escape character itself", () => {
    expect(escapeLikePattern("100%_x\\y")).toBe("100\\%\\_x\\\\y");
  });
});

describe("buildPostgresMatch", () => {
  it("binds a tsquery plus an escaped ILIKE fallback", () => {
    const frag = buildPostgresMatch("Payment", "invoice");
    expect(frag).not.toBeNull();
    expect(frag!.text).toContain(SEARCH_VECTOR_COLUMN);
    expect(frag!.text).toContain("to_tsquery");
    expect(frag!.text).toContain("ILIKE");
    expect(frag!.params).toEqual(["invoice:*", "%invoice%"]);
  });

  it("respects baseParamIndex when spliced into a larger statement", () => {
    const frag = buildPostgresMatch("AuditLog", "login", 4);
    expect(frag!.text).toContain("$4");
    expect(frag!.text).toContain("$5");
  });

  it("adds an exact-match predicate for a pasted transaction hash", () => {
    const hash = "a".repeat(64);
    const frag = buildPostgresMatch("Payment", hash);
    expect(frag!.text).toContain('"transactionHash" =');
    expect(frag!.params).toContain(hash);
  });

  it("returns null for an empty search", () => {
    expect(buildPostgresMatch("Payment", "   ")).toBeNull();
  });
});

describe("buildPostgresRank", () => {
  it("uses ts_rank over the search vector", () => {
    const frag = buildPostgresRank("Payment", "invoice");
    expect(frag!.text).toContain("ts_rank");
    expect(frag!.text).toContain(SEARCH_VECTOR_COLUMN);
    expect(frag!.params).toEqual(["invoice:*"]);
  });

  it("returns null for an empty search", () => {
    expect(buildPostgresRank("AuditLog", "")).toBeNull();
  });
});

describe("buildFallbackWhere", () => {
  it("keeps the #157 substring semantics for the payment path", () => {
    expect(buildFallbackWhere("Payment", "inv")).toEqual([
      { description: { contains: "inv" } },
      { memo: { contains: "inv", mode: "insensitive" } },
      { transactionHash: { equals: "inv" } },
    ]);
  });

  it("searches actor and action for the audit fallback", () => {
    expect(buildFallbackWhere("AuditLog", "refund")).toEqual([
      { actor: { contains: "refund", mode: "insensitive" } },
      { action: { contains: "refund", mode: "insensitive" } },
    ]);
  });

  it("returns no predicates for an empty search", () => {
    expect(buildFallbackWhere("Payment", "  ")).toEqual([]);
  });
});
