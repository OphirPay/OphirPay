import { describe, expect, it } from "vitest";

import {
  detectMemoType,
  hashMemo,
  hashMemoSync,
  sanitizeMemo,
  sanitizeMemoHtml,
  validateMemo,
  verifyMemo,
} from "./memo";

describe("Memo Utilities, Validation & Sanitization", () => {
  describe("validateMemo", () => {
    it("accepts valid text memos within 28 bytes", () => {
      expect(validateMemo("invoice-10294", "text")).toEqual({
        valid: true,
        type: "text",
      });
      expect(validateMemo("1234567890123456789012345678", "text")).toEqual({
        valid: true,
        type: "text",
      });
    });

    it("rejects text memos exceeding 28 bytes", () => {
      const longMemo = "12345678901234567890123456789"; // 29 bytes
      const result = validateMemo(longMemo, "text");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("28 bytes or fewer");
    });

    it("rejects text memos with illegal control characters", () => {
      const result = validateMemo("test\x00memo", "text");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("control characters");
    });

    it("validates 64-bit integer ID memos", () => {
      expect(validateMemo("123456", "id")).toEqual({
        valid: true,
        type: "id",
      });
      expect(validateMemo("-5", "id").valid).toBe(false);
      expect(validateMemo("not-a-number", "id").valid).toBe(false);
    });

    it("validates 32-byte (64 hex character) hash and return memos", () => {
      const validHash = "a".repeat(64);
      expect(validateMemo(validHash, "hash")).toEqual({
        valid: true,
        type: "hash",
      });
      expect(validateMemo("short-hash", "hash").valid).toBe(false);
    });
  });

  describe("sanitizeMemoHtml", () => {
    it("escapes dangerous HTML/XSS characters for UI safety", () => {
      const malicious = '<script>alert("xss")</script>&test';
      const sanitized = sanitizeMemoHtml(malicious);

      expect(sanitized).not.toContain("<script>");
      expect(sanitized).toBe(
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;&amp;test",
      );
    });

    it("handles empty strings cleanly", () => {
      expect(sanitizeMemoHtml("")).toBe("");
    });
  });

  describe("sanitizeMemo", () => {
    it("strips invisible control characters and trims whitespace", () => {
      const input = "  \x00invoice-99\x1F  ";
      expect(sanitizeMemo(input)).toBe("invoice-99");
    });
  });

  describe("detectMemoType", () => {
    it("detects ID, Hash, and Text types automatically", () => {
      expect(detectMemoType("12345")).toBe("id");
      expect(detectMemoType("b".repeat(64))).toBe("hash");
      expect(detectMemoType("hello-world")).toBe("text");
      expect(detectMemoType("")).toBe("text");
    });
  });

  describe("hashing and verification", () => {
    it("hashes and verifies memos correctly", async () => {
      const memo = "secret-order-482";
      const syncHash = hashMemoSync(memo);
      expect(syncHash.length).toBeLessThanOrEqual(28);

      const asyncHash = await hashMemo(memo);
      expect(asyncHash).toHaveLength(28);


      expect(verifyMemo(memo, memo)).toBe(true);
      expect(verifyMemo(memo, "other-memo")).toBe(false);
    });
  });
});
