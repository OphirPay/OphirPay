// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  generatePaymentLink,
  parsePaymentLink,
  memoByteLength,
  MAX_MEMO_BYTES,
} from "@/lib/payment-link";

// `useSearchParams` is the only thing the prefill hook needs from Next, so the
// hook can be exercised without the wallet/toast/transaction stack the send
// page otherwise pulls in.
const h = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => h.params,
}));

import { usePaymentLinkPrefill } from "@/hooks/usePaymentLinkPrefill";

/** 56 characters starting with G, matching the address format the app accepts. */
const VALID_ADDRESS = "G" + "A".repeat(55);

const params = (init: string) => new URLSearchParams(init);

beforeEach(() => {
  h.params = new URLSearchParams();
});

// ─── Parsing ────────────────────────────────────────────────────

describe("parsePaymentLink", () => {
  it("reports 'empty' when no recipient is present", () => {
    // A plain visit to /send is not an error and must not warn.
    expect(parsePaymentLink(params("")).status).toBe("empty");
  });

  it("treats a blank recipient as empty rather than invalid", () => {
    expect(parsePaymentLink(params("dest=%20%20")).status).toBe("empty");
  });

  it("accepts a well-formed address", () => {
    const result = parsePaymentLink(params(`dest=${VALID_ADDRESS}`));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.destination).toBe(VALID_ADDRESS);
    }
  });

  it("rejects a malformed address with a readable message", () => {
    const result = parsePaymentLink(params("dest=not-an-address"));
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.error).toMatch(/invalid Stellar address/i);
    }
  });

  it("rejects a lowercase address", () => {
    const result = parsePaymentLink(params(`dest=${VALID_ADDRESS.toLowerCase()}`));
    expect(result.status).toBe("invalid");
  });

  it("rejects an address of the wrong length", () => {
    expect(parsePaymentLink(params(`dest=G${"A".repeat(54)}`)).status).toBe(
      "invalid"
    );
    expect(parsePaymentLink(params(`dest=G${"A".repeat(56)}`)).status).toBe(
      "invalid"
    );
  });

  it("carries optional amount, memo and asset through", () => {
    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&amount=12.5&memo=invoice-42&asset=USDC`)
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual({
        destination: VALID_ADDRESS,
        amount: "12.5",
        memo: "invoice-42",
        assetCode: "USDC",
      });
    }
  });

  it("omits absent optional fields rather than setting them empty", () => {
    const result = parsePaymentLink(params(`dest=${VALID_ADDRESS}`));
    if (result.status === "ok") {
      expect(result.value).toEqual({ destination: VALID_ADDRESS });
    }
  });

  it.each(["0", "-1", "abc", "NaN", "Infinity"])(
    "rejects the invalid amount %s",
    (amount) => {
      const result = parsePaymentLink(
        params(`dest=${VALID_ADDRESS}&amount=${amount}`)
      );
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.error).toMatch(/invalid amount/i);
      }
    }
  );

  it("rejects a memo longer than the Stellar limit", () => {
    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&memo=${"x".repeat(MAX_MEMO_BYTES + 1)}`)
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.error).toMatch(new RegExp(`${MAX_MEMO_BYTES}`));
    }
  });

  it("accepts a memo exactly at the limit", () => {
    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&memo=${"x".repeat(MAX_MEMO_BYTES)}`)
    );
    expect(result.status).toBe("ok");
  });

  it("measures the memo limit in BYTES, not characters", () => {
    // MEMO_TEXT is capped at 28 bytes. Ten Chinese characters are 30 bytes but
    // only 10 JavaScript code units, so a length check would wrongly accept
    // this and the transaction would throw at Memo.text construction.
    const tenChineseChars = "一二三四五六七八九十";
    expect(tenChineseChars.length).toBe(10);
    expect(memoByteLength(tenChineseChars)).toBe(30);

    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&memo=${encodeURIComponent(tenChineseChars)}`)
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.error).toMatch(/byte/i);
    }
  });

  it("accepts a multibyte memo that fits within the byte budget", () => {
    const shortChinese = "咖啡"; // 6 bytes
    expect(memoByteLength(shortChinese)).toBe(6);
    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&memo=${encodeURIComponent(shortChinese)}`)
    );
    expect(result.status).toBe("ok");
  });

  it("rejects an asset the app cannot resolve to an issuer", () => {
    // buildPaymentTx falls back to Asset.native() when the issuer is missing,
    // so accepting `asset=FOO` would show FOO in the form and send XLM.
    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&asset=FOO`)
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.error).toMatch(/unsupported asset/i);
    }
  });

  it.each(["XLM", "USDC", "usdc"])("accepts the supported asset %s", (code) => {
    const result = parsePaymentLink(
      params(`dest=${VALID_ADDRESS}&asset=${code}`)
    );
    expect(result.status).toBe("ok");
  });

  it("trims surrounding whitespace", () => {
    const result = parsePaymentLink(
      params(`dest=%20${VALID_ADDRESS}%20&memo=%20hi%20`)
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value.destination).toBe(VALID_ADDRESS);
      expect(result.value.memo).toBe("hi");
    }
  });

  it("round-trips a link produced by generatePaymentLink", () => {
    const link = generatePaymentLink({
      destination: VALID_ADDRESS,
      amount: "42",
      memo: "coffee",
      assetCode: "XLM",
    });
    const result = parsePaymentLink(new URL(link).searchParams);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.value).toEqual({
        destination: VALID_ADDRESS,
        amount: "42",
        memo: "coffee",
        assetCode: "XLM",
      });
    }
  });
});

// ─── Prefill ────────────────────────────────────────────────────

describe("usePaymentLinkPrefill", () => {
  it("yields nothing to fill and no error for a plain visit", () => {
    const { result } = renderHook(() => usePaymentLinkPrefill());
    expect(result.current.value).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns the parsed values for a valid link", () => {
    h.params = params(`dest=${VALID_ADDRESS}&amount=7&memo=rent`);
    const { result } = renderHook(() => usePaymentLinkPrefill());
    expect(result.current.error).toBeNull();
    expect(result.current.value).toEqual({
      destination: VALID_ADDRESS,
      amount: "7",
      memo: "rent",
    });
  });

  it("returns an error and no values for a malformed link", () => {
    // The form must be left blank so a bad address cannot be submitted
    // unnoticed.
    h.params = params("dest=nope");
    const { result } = renderHook(() => usePaymentLinkPrefill());
    expect(result.current.value).toBeNull();
    expect(result.current.error).toMatch(/invalid Stellar address/i);
  });

  it("reflects a changed query string rather than stale values", () => {
    // Navigating between payment links is a client-side query change that does
    // not remount the page, so the hook must report the new link's values.
    h.params = params(`dest=${VALID_ADDRESS}&amount=7&memo=rent`);
    const first = renderHook(() => usePaymentLinkPrefill());
    expect(first.result.current.value?.amount).toBe("7");

    h.params = params(`dest=${VALID_ADDRESS}`);
    const second = renderHook(() => usePaymentLinkPrefill());
    expect(second.result.current.value?.amount).toBeUndefined();
    expect(second.result.current.value?.memo).toBeUndefined();
  });

  it("surfaces an error for a valid address with a bad amount", () => {
    h.params = params(`dest=${VALID_ADDRESS}&amount=-5`);
    const { result } = renderHook(() => usePaymentLinkPrefill());
    expect(result.current.value).toBeNull();
    expect(result.current.error).toMatch(/invalid amount/i);
  });
});
