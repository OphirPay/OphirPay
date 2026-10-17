// SPDX-License-Identifier: MIT
// Tests for issue #1368: Stellar memo validation
import { describe, it, expect } from "vitest";
import {
  validateStellarMemo,
  stellarTextMemo,
  stellarIdMemo,
  stellarHashMemo,
  stellarReturnMemo,
  stellarMemo,
  stellarMemoTyped,
  MEMO_MAX_BYTES,
} from "@/lib/validation/stellar";

describe("validateStellarMemo", () => {
  describe("text memos", () => {
    it("accepts a simple ASCII text memo", () => {
      expect(validateStellarMemo("hello", "text")).toBeNull();
    });

    it("accepts an empty memo", () => {
      expect(validateStellarMemo("", "text")).toBeNull();
    });

    it("accepts a memo at exactly 28 bytes", () => {
      const memo = "a".repeat(28);
      expect(validateStellarMemo(memo, "text")).toBeNull();
    });

    it("rejects a memo exceeding 28 bytes", () => {
      const memo = "a".repeat(29);
      const result = validateStellarMemo(memo, "text");
      expect(result).toContain("28 characters or fewer");
    });

    it("correctly byte-counts multibyte UTF-8 characters", () => {
      // Each emoji is 4 bytes in UTF-8, so 7 emojis = 28 bytes
      const memo = "😀".repeat(7);
      expect(validateStellarMemo(memo, "text")).toBeNull();

      // 8 emojis = 32 bytes > 28
      const tooLong = "😀".repeat(8);
      const result = validateStellarMemo(tooLong, "text");
      expect(result).toContain("28 bytes or fewer");
    });

    it("correctly byte-counts accented characters", () => {
      // Each accented character is 2 bytes in UTF-8
      // 14 chars × 2 bytes = 28 bytes
      const memo = "é".repeat(14);
      expect(validateStellarMemo(memo, "text")).toBeNull();

      // 15 chars × 2 bytes = 30 bytes > 28
      const tooLong = "é".repeat(15);
      const result = validateStellarMemo(tooLong, "text");
      expect(result).toContain("28 bytes or fewer");
    });

    it("rejects control characters", () => {
      expect(validateStellarMemo("hello\nworld", "text")).toContain(
        "control or invisible",
      );
      expect(validateStellarMemo("hello\tworld", "text")).toContain(
        "control or invisible",
      );
    });

    it("rejects zero-width characters", () => {
      expect(validateStellarMemo("hello\u200Bworld", "text")).toContain(
        "control or invisible",
      );
    });
  });

  describe("id memos", () => {
    it("accepts a valid integer ID", () => {
      expect(validateStellarMemo("12345", "id")).toBeNull();
    });

    it("accepts zero as an ID", () => {
      expect(validateStellarMemo("0", "id")).toBeNull();
    });

    it("accepts max u64 value", () => {
      expect(
        validateStellarMemo("18446744073709551615", "id"),
      ).toBeNull();
    });

    it("rejects non-numeric strings", () => {
      expect(validateStellarMemo("abc", "id")).toContain(
        "non-negative 64-bit integer",
      );
    });

    it("rejects negative numbers", () => {
      expect(validateStellarMemo("-1", "id")).toContain(
        "non-negative 64-bit integer",
      );
    });

    it("rejects numbers exceeding u64 max", () => {
      expect(
        validateStellarMemo("18446744073709551616", "id"),
      ).toContain("non-negative 64-bit integer");
    });
  });

  describe("hash memos", () => {
    it("accepts a valid 64-char hex string", () => {
      expect(
        validateStellarMemo("a".repeat(64), "hash"),
      ).toBeNull();
    });

    it("accepts mixed-case hex", () => {
      const hex = "ABCDEF0123456789".repeat(4);
      expect(validateStellarMemo(hex, "hash")).toBeNull();
    });

    it("rejects non-hex characters", () => {
      expect(validateStellarMemo("g".repeat(64), "hash")).toContain(
        "64-character hex",
      );
    });

    it("rejects strings shorter than 64 chars", () => {
      expect(
        validateStellarMemo("a".repeat(63), "hash"),
      ).toContain("64-character hex");
    });

    it("rejects strings longer than 64 chars", () => {
      expect(
        validateStellarMemo("a".repeat(65), "hash"),
      ).toContain("64-character hex");
    });
  });

  describe("return memos", () => {
    it("accepts a valid 64-char hex string", () => {
      expect(
        validateStellarMemo("b".repeat(64), "return"),
      ).toBeNull();
    });

    it("rejects invalid hex", () => {
      expect(validateStellarMemo("xyz", "return")).toContain(
        "64-character hex",
      );
    });
  });
});

describe("stellarTextMemo schema", () => {
  it("passes validation for valid text", () => {
    expect(stellarTextMemo.safeParse("hello").success).toBe(true);
  });

  it("fails for oversized text", () => {
    expect(stellarTextMemo.safeParse("a".repeat(29)).success).toBe(false);
  });

  it("accepts undefined (optional)", () => {
    expect(stellarTextMemo.safeParse(undefined).success).toBe(true);
  });
});

describe("stellarIdMemo schema", () => {
  it("passes validation for valid ID", () => {
    expect(stellarIdMemo.safeParse("12345").success).toBe(true);
  });

  it("fails for non-numeric", () => {
    expect(stellarIdMemo.safeParse("abc").success).toBe(false);
  });
});

describe("stellarHashMemo schema", () => {
  it("passes validation for valid hash", () => {
    expect(
      stellarHashMemo.safeParse("a".repeat(64)).success,
    ).toBe(true);
  });

  it("fails for invalid hash", () => {
    expect(stellarHashMemo.safeParse("abc").success).toBe(false);
  });
});

describe("stellarMemo (auto-detect) schema", () => {
  it("accepts valid text", () => {
    expect(stellarMemo.safeParse("hello").success).toBe(true);
  });

  it("accepts valid ID (numeric)", () => {
    expect(stellarMemo.safeParse("12345").success).toBe(true);
  });

  it("accepts valid hash (64 hex chars)", () => {
    expect(stellarMemo.safeParse("a".repeat(64)).success).toBe(true);
  });

  it("rejects oversized text", () => {
    expect(stellarMemo.safeParse("a".repeat(29)).success).toBe(false);
  });
});

describe("stellarMemoTyped schema", () => {
  it("accepts valid typed text memo", () => {
    expect(
      stellarMemoTyped.safeParse({ type: "text", value: "hello" })
        .success,
    ).toBe(true);
  });

  it("accepts valid typed id memo", () => {
    expect(
      stellarMemoTyped.safeParse({ type: "id", value: "42" }).success,
    ).toBe(true);
  });

  it("rejects invalid typed hash", () => {
    expect(
      stellarMemoTyped.safeParse({ type: "hash", value: "abc" }).success,
    ).toBe(false);
  });
});
