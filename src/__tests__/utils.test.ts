// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  shortenAddress,
  formatAmount,
  timeAgo,
  getStatusColor,
  cn,
} from "@/lib/utils";

describe("shortenAddress", () => {
  it("shortens a Stellar address to GXXX...XXXX format", () => {
    const addr = "GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const result = shortenAddress(addr);
    expect(result).toContain("...");
    expect(result).toMatch(/^G.{4}\.\.\.(.{4})$/);
  });

  it("handles custom segment length", () => {
    const addr = "GABCDEFGHIJKLMNOPQRST1234567890ABCDEFGHIJKLMNOPQRST";
    const result = shortenAddress(addr, 8);
    expect(result).toContain("...");
  });
});

describe("formatAmount", () => {
  it("formats a number with XLM suffix", () => {
    expect(formatAmount(12500.5, "XLM")).toBe("12,500.50 XLM");
  });

  it("formats without an asset code", () => {
    expect(formatAmount(1000, "XLM")).toBe("1,000.00 XLM");
  });

  it("handles zero", () => {
    expect(formatAmount(0, "XLM")).toBe("0.00 XLM");
  });
});

describe("getStatusColor", () => {
  it("returns green for COMPLETED", () => {
    const result = getStatusColor("COMPLETED");
    expect(result.bg).toContain("green");
    expect(result.text).toContain("green");
  });

  it("returns blue for PENDING", () => {
    const result = getStatusColor("PENDING");
    expect(result.bg).toContain("blue");
  });

  it("returns red for FAILED", () => {
    const result = getStatusColor("FAILED");
    expect(result.bg).toContain("red");
  });
});

describe("timeAgo", () => {
  it('returns "just now" for recent dates', () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("just now");
  });

  it("returns minutes for dates within the hour", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const result = timeAgo(tenMinAgo);
    expect(result).toMatch(/\d+m ago/);
  });
});

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("filters falsy values", () => {
    expect(cn("px-4", false, undefined, "py-2", null)).toBe("px-4 py-2");
  });
});
