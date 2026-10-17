// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  STELLAR_MEMO_MAX_BYTES,
  STELLAR_MEMO_ERROR_MESSAGES,
  getUtf8ByteLength,
  isValidUtf8String,
  isValidStellarMemoId,
  isValidStellarMemoHexHash,
  validateStellarMemo,
  stellarMemoTextSchema,
  stellarMemoIdSchema,
  stellarMemoHashSchema,
  stellarMemoReturnSchema,
  stellarMemoPayloadSchema,
} from "@/lib/validation/stellar";
import {
  createPaymentSchema,
  createPaymentRequestSchema,
} from "@/lib/validation-schemas";

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      create: vi.fn(),
    },
    paymentRequest: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn(() => null),
}));

vi.mock("@/lib/webhook-dispatcher", () => ({
  dispatchWebhookEventAsync: vi.fn(),
}));

vi.mock("@/lib/api-cache", () => ({
  invalidateCaches: vi.fn(() => Promise.resolve()),
}));

import prisma from "@/lib/prisma";
import * as authSession from "@/lib/auth-session";
import { POST as createPayment } from "@/app/api/payments/route";
import { POST as createPaymentRequest } from "@/app/api/requests/route";

const VALID_STELLAR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const MOCK_AUTH = {
  userId: "user_memo_1368",
  publicKey: VALID_STELLAR,
};

describe("Stellar Transaction Memo Encoding & Charset Validation (#1368)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authSession.getAuthContext).mockResolvedValue(MOCK_AUTH);
  });

  describe("UTF-8 encoding & byte-length helpers", () => {
    it("calculates exact UTF-8 byte length for ASCII, accented, CJK, and emoji strings", () => {
      expect(getUtf8ByteLength("invoice-001")).toBe(11);
      expect(getUtf8ByteLength("é".repeat(14))).toBe(28); // 2 bytes each
      expect(getUtf8ByteLength("星".repeat(9))).toBe(27); // 3 bytes each
      expect(getUtf8ByteLength("🚀".repeat(7))).toBe(28); // 4 bytes each
      expect(getUtf8ByteLength("🚀".repeat(8))).toBe(32);
    });

    it("detects invalid UTF-8 sequences (lone surrogates and U+FFFD)", () => {
      expect(isValidUtf8String("Valid UTF-8 🚀 café")).toBe(true);
      // Unpaired high surrogate
      expect(isValidUtf8String("bad\uD800memo")).toBe(false);
      // Unpaired low surrogate
      expect(isValidUtf8String("bad\uDC00memo")).toBe(false);
      // High surrogate at end of string
      expect(isValidUtf8String("trailing\uD83D")).toBe(false);
      // Unicode replacement character
      expect(isValidUtf8String("corrupt\uFFFDchar")).toBe(false);
    });
  });

  describe("Variant 1: MEMO_TEXT", () => {
    it("accepts ASCII text up to 28 bytes and rejects 29+ characters", () => {
      expect(stellarMemoTextSchema.safeParse("a".repeat(28)).success).toBe(true);
      const tooLong = stellarMemoTextSchema.safeParse("a".repeat(29));
      expect(tooLong.success).toBe(false);
      if (!tooLong.success) {
        expect(tooLong.error.issues[0].message).toBe(
          STELLAR_MEMO_ERROR_MESSAGES.tooLong
        );
      }
    });

    it("enforces the 28-byte UTF-8 limit on multibyte characters (emojis, accented, CJK)", () => {
      // 7 emojis = 28 UTF-8 bytes -> valid
      expect(validateStellarMemo("🚀".repeat(7), "MEMO_TEXT").valid).toBe(true);
      // 8 emojis = 32 UTF-8 bytes (only 16 UTF-16 code units) -> invalid
      const emojiOverflow = validateStellarMemo("🚀".repeat(8), "MEMO_TEXT");
      expect(emojiOverflow.valid).toBe(false);
      expect(emojiOverflow.byteLength).toBe(32);
      expect(emojiOverflow.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes);

      // 14 accented chars ('é' = 2 bytes) = 28 bytes -> valid
      expect(validateStellarMemo("é".repeat(14), "MEMO_TEXT").valid).toBe(true);
      // 15 accented chars = 30 bytes (only 15 chars) -> invalid
      const accentOverflow = validateStellarMemo("é".repeat(15), "MEMO_TEXT");
      expect(accentOverflow.valid).toBe(false);
      expect(accentOverflow.byteLength).toBe(30);
      expect(accentOverflow.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes);

      // 9 CJK chars ('星' = 3 bytes) = 27 bytes -> valid
      expect(validateStellarMemo("星".repeat(9), "MEMO_TEXT").valid).toBe(true);
      // 10 CJK chars = 30 bytes -> invalid
      const cjkOverflow = validateStellarMemo("星".repeat(10), "MEMO_TEXT");
      expect(cjkOverflow.valid).toBe(false);
      expect(cjkOverflow.byteLength).toBe(30);
      expect(cjkOverflow.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes);
    });

    it("rejects invalid UTF-8 sequences and control/bidi characters", () => {
      const loneSurrogate = validateStellarMemo("pay\uD800now", "MEMO_TEXT");
      expect(loneSurrogate.valid).toBe(false);
      expect(loneSurrogate.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidUtf8);

      const controlChar = validateStellarMemo("pay\u0000now", "MEMO_TEXT");
      expect(controlChar.valid).toBe(false);
      expect(controlChar.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.controlChars);
    });
  });

  describe("Variant 2: MEMO_ID", () => {
    it("accepts valid unsigned 64-bit integer strings (0 .. 18446744073709551615)", () => {
      expect(isValidStellarMemoId("0")).toBe(true);
      expect(isValidStellarMemoId("987654321012345678")).toBe(true);
      expect(isValidStellarMemoId("18446744073709551615")).toBe(true);
      expect(stellarMemoIdSchema.safeParse("18446744073709551615").success).toBe(
        true
      );
    });

    it("rejects negative numbers, u64 overflow, leading zeros, decimals, and non-digits", () => {
      for (const bad of [
        "-1",
        "18446744073709551616", // u64 max + 1
        "999999999999999999999",
        "007",
        "12.34",
        "abc123",
        "",
      ]) {
        const res = validateStellarMemo(bad, "MEMO_ID");
        expect(res.valid, `Expected ${bad} to be invalid MEMO_ID`).toBe(false);
        expect(res.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidMemoId);
      }
    });
  });

  describe("Variant 3 & 4: MEMO_HASH and MEMO_RETURN", () => {
    const validHex =
      "0123456789abcdefABCDEF0123456789abcdefABCDEF0123456789abcdef0123";

    it("accepts valid 64-character hex strings for MEMO_HASH and MEMO_RETURN", () => {
      expect(isValidStellarMemoHexHash(validHex)).toBe(true);
      expect(stellarMemoHashSchema.safeParse(validHex).success).toBe(true);
      expect(stellarMemoReturnSchema.safeParse(validHex).success).toBe(true);

      const hashRes = validateStellarMemo(validHex, "MEMO_HASH");
      expect(hashRes.valid).toBe(true);
      expect(hashRes.byteLength).toBe(32);

      const returnRes = validateStellarMemo(validHex, "MEMO_RETURN");
      expect(returnRes.valid).toBe(true);
      expect(returnRes.byteLength).toBe(32);
    });

    it("rejects wrong-length or non-hex strings for MEMO_HASH and MEMO_RETURN", () => {
      const badHash = validateStellarMemo("a".repeat(63), "MEMO_HASH");
      expect(badHash.valid).toBe(false);
      expect(badHash.error).toBe(STELLAR_MEMO_ERROR_MESSAGES.invalidMemoHash);

      const badReturn = validateStellarMemo("z".repeat(64), "MEMO_RETURN");
      expect(badReturn.valid).toBe(false);
      expect(badReturn.error).toBe(
        STELLAR_MEMO_ERROR_MESSAGES.invalidMemoReturn
      );
    });

    it("validates combined { memo, memoType } payloads via stellarMemoPayloadSchema", () => {
      expect(
        stellarMemoPayloadSchema.safeParse({
          memo: validHex,
          memoType: "MEMO_HASH",
        }).success
      ).toBe(true);

      expect(
        stellarMemoPayloadSchema.safeParse({
          memo: "not-a-hash",
          memoType: "MEMO_RETURN",
        }).success
      ).toBe(false);
    });
  });

  describe("Route integration: POST /api/payments & POST /api/requests", () => {
    it("returns 400 Bad Request on POST /api/payments when MEMO_TEXT exceeds 28 UTF-8 bytes", async () => {
      const res = await createPayment(
        new Request("http://localhost/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: 50,
            sourceAccountId: "acc_1",
            destAddress: VALID_STELLAR,
            memo: "🎉".repeat(8), // 32 UTF-8 bytes, 16 chars
            memoType: "MEMO_TEXT",
          }),
        })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(JSON.stringify(body.error)).toContain(
        STELLAR_MEMO_ERROR_MESSAGES.tooManyBytes
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it("returns 400 Bad Request on POST /api/payments when MEMO_ID or MEMO_HASH is invalid", async () => {
      const badIdRes = await createPayment(
        new Request("http://localhost/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: 50,
            sourceAccountId: "acc_1",
            destAddress: VALID_STELLAR,
            memo: "18446744073709551616",
            memoType: "MEMO_ID",
          }),
        })
      );
      expect(badIdRes.status).toBe(400);
      const badIdBody = await badIdRes.json();
      expect(JSON.stringify(badIdBody.error)).toContain(
        "unsigned 64-bit integer"
      );

      const badHashRes = await createPayment(
        new Request("http://localhost/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: 50,
            sourceAccountId: "acc_1",
            destAddress: VALID_STELLAR,
            memo: "deadbeef",
            memoType: "MEMO_HASH",
          }),
        })
      );
      expect(badHashRes.status).toBe(400);
      const badHashBody = await badHashRes.json();
      expect(JSON.stringify(badHashBody.error)).toContain(
        "64-character hexadecimal"
      );
    });

    it("returns 201 Created on POST /api/payments for valid MEMO_HASH and multibyte MEMO_TEXT <= 28 bytes", async () => {
      const validHex = "a".repeat(64);
      vi.mocked(prisma.payment.create).mockResolvedValue({
        id: "pay_memo_ok",
        amount: 25,
        assetCode: "XLM",
        status: "CREATED",
        memo: validHex,
        createdAt: new Date("2026-08-26T12:00:00Z"),
      } as never);

      const res = await createPayment(
        new Request("http://localhost/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: 25,
            sourceAccountId: "acc_1",
            destAddress: VALID_STELLAR,
            memo: validHex,
            memoType: "MEMO_HASH",
          }),
        })
      );
      expect(res.status).toBe(201);
      expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    });

    it("returns 400 Bad Request on POST /api/requests for invalid memos and 201 Created for valid memos", async () => {
      const badReqRes = await createPaymentRequest(
        new Request("http://localhost/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: 100,
            assetCode: "USDC",
            memo: "bad\uD800utf8",
            memoType: "MEMO_TEXT",
          }),
        })
      );
      expect(badReqRes.status).toBe(400);
      const badReqBody = await badReqRes.json();
      expect(JSON.stringify(badReqBody.error)).toContain("invalid UTF-8");
      expect(prisma.paymentRequest.create).not.toHaveBeenCalled();

      vi.mocked(prisma.paymentRequest.create).mockResolvedValue({
        id: "req_memo_ok",
        amount: 100,
        assetCode: "USDC",
        description: "Invoice #99",
        status: "PENDING",
        createdAt: new Date("2026-08-26T12:00:00Z"),
      } as never);

      const okReqRes = await createPaymentRequest(
        new Request("http://localhost/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: 100,
            assetCode: "USDC",
            memo: "18446744073709551615",
            memoType: "MEMO_ID",
          }),
        })
      );
      expect(okReqRes.status).toBe(201);
      expect(prisma.paymentRequest.create).toHaveBeenCalledTimes(1);

      // Verify schema constant export
      expect(STELLAR_MEMO_MAX_BYTES).toBe(28);
      expect(
        createPaymentRequestSchema.safeParse({
          amount: 10,
          memo: "f".repeat(64),
          memoType: "MEMO_RETURN",
        }).success
      ).toBe(true);
      expect(
        createPaymentSchema.safeParse({
          amount: 10,
          sourceAccountId: "acc_1",
          destAddress: VALID_STELLAR,
          memo: "f".repeat(64),
          memoType: "MEMO_RETURN",
        }).success
      ).toBe(true);
    });
  });
});
