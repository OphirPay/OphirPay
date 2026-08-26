// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { sanitizeHtml, escapeHtml, sanitizeStellarAddress } from "@/lib/sanitize";
import { hashMemoSync, verifyMemo } from "@/lib/memo";
import { XLM_ASSET, getAssetInfo, formatAssetAmount } from "@/lib/assets";
import { handlePrismaError } from "@/lib/prisma-errors";
import { Prisma } from "@prisma/client";

describe("sanitizeHtml", () => {
  it("strips HTML characters from input", () => {
    const result = sanitizeHtml("<script>alert('xss')</script>");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain('"');
  });

  it("strips quotes and ampersands", () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).not.toContain("<");
  });

  it("truncates to maxLength", () => {
    expect(sanitizeHtml("hello world", 5)).toBe("hello");
  });
});

describe("escapeHtml", () => {
  it("escapes HTML entities", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
    expect(escapeHtml('"hello" & "world"')).toBe("&quot;hello&quot; &amp; &quot;world&quot;");
  });
});

describe("sanitizeStellarAddress", () => {
  it("strips non-alphanumeric characters", () => {
    expect(sanitizeStellarAddress("GABC-DEF!@#123")).toBe("GABCDEF123");
  });

  it("truncates to 56 chars", () => {
    expect(sanitizeStellarAddress("G" + "A".repeat(100)).length).toBe(56);
  });
});

describe("hashMemoSync", () => {
  it("produces a consistent hash", () => {
    const h1 = hashMemoSync("invoice-12345");
    const h2 = hashMemoSync("invoice-12345");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashMemoSync("a")).not.toBe(hashMemoSync("b"));
  });

  it("respects length parameter", () => {
    expect(hashMemoSync("test", 10).length).toBeLessThanOrEqual(10);
  });
});

describe("verifyMemo", () => {
  it("verifies matching memo and reference", () => {
    expect(verifyMemo("invoice-42", "invoice-42")).toBe(true);
  });

  it("verifies hashed memo differs from original", () => {
    const hashed = hashMemoSync("invoice-42");
    expect(hashed).not.toBe("invoice-42");
  });

  it("rejects non-matching reference", () => {
    expect(verifyMemo(hashMemoSync("inv-1"), "inv-2")).toBe(false);
  });
});

describe("getAssetInfo", () => {
  it("returns XLM info", () => {
    expect(getAssetInfo("XLM").type).toBe("native");
  });

  it("returns USDC info", () => {
    expect(getAssetInfo("USDC").code).toBe("USDC");
  });

  it("returns generic for unknown assets", () => {
    const info = getAssetInfo("FANCY");
    expect(info.code).toBe("FANCY");
    expect(info.type).toBe("credit_alphanum4");
  });
});

describe("formatAssetAmount", () => {
  it("formats XLM stroops", () => {
    expect(formatAssetAmount(12500000, XLM_ASSET)).toBe("1.25");
  });

  it("handles zero", () => {
    expect(formatAssetAmount(0, XLM_ASSET)).toBe("0.00");
  });
});

describe("handlePrismaError", () => {
  it("maps P2002 to 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("unique constraint", {
      code: "P2002", clientVersion: "5.0",
    });
    const result = handlePrismaError(err);
    expect(result.code).toBe("UNIQUE_CONSTRAINT");
    expect(result.status).toBe(409);
  });

  it("maps P2025 to 404", () => {
    const err = new Prisma.PrismaClientKnownRequestError("not found", {
      code: "P2025", clientVersion: "5.0",
    });
    expect(handlePrismaError(err).status).toBe(404);
  });

  it("handles generic errors", () => {
    expect(handlePrismaError(new Error("boom")).status).toBe(500);
  });
});
