// SPDX-License-Identifier: MIT
// Tests for src/lib/validate-params.ts — shared route-param validation

import { describe, it, expect } from "vitest";
import {
  validateParam,
  validateIdParam,
  recordId,
  numericId,
  stellarAddressId,
} from "@/lib/validate-params";

const VALID_CUID = "cabcdefghijklmnopqrstuvwx"; // 25 chars: c + 24 alnum
const VALID_ADDRESS =
  "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U";

describe("validate-params > recordId schema", () => {
  it("accepts a valid cuid", () => {
    expect(recordId.safeParse(VALID_CUID).success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(recordId.safeParse("").success).toBe(false);
  });

  it("rejects a numeric-only id", () => {
    expect(recordId.safeParse("12345").success).toBe(false);
  });

  it("rejects a value not starting with 'c'", () => {
    expect(recordId.safeParse("xabcdefghijklmnopqrstuvwx").success).toBe(
      false,
    );
  });

  it("rejects a value with path-traversal characters", () => {
    expect(recordId.safeParse("../../etc/passwd").success).toBe(false);
  });

  it("rejects a value with SQL-injection-like content", () => {
    expect(recordId.safeParse("c1' OR '1'='1").success).toBe(false);
  });
});

describe("validate-params > numericId schema", () => {
  it("accepts a valid numeric string", () => {
    expect(numericId.safeParse("42").success).toBe(true);
  });

  it("accepts '0'", () => {
    expect(numericId.safeParse("0").success).toBe(true);
  });

  it("rejects a non-numeric string", () => {
    expect(numericId.safeParse("abc").success).toBe(false);
  });

  it("rejects a negative number", () => {
    expect(numericId.safeParse("-1").success).toBe(false);
  });

  it("rejects a decimal", () => {
    expect(numericId.safeParse("1.5").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(numericId.safeParse("").success).toBe(false);
  });

  it("rejects a value with trailing garbage", () => {
    expect(numericId.safeParse("42abc").success).toBe(false);
  });

  it("rejects a number outside the safe integer range", () => {
    expect(numericId.safeParse("99999999999999999999").success).toBe(false);
  });
});

describe("validate-params > stellarAddressId schema", () => {
  it("accepts a valid Stellar address", () => {
    expect(stellarAddressId.safeParse(VALID_ADDRESS).success).toBe(true);
  });

  it("rejects an address that is too short", () => {
    expect(stellarAddressId.safeParse("GABC123").success).toBe(false);
  });

  it("rejects an address not starting with G", () => {
    expect(
      stellarAddressId.safeParse(
        "SACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      ).success,
    ).toBe(false);
  });

  it("rejects an address with lowercase characters", () => {
    expect(
      stellarAddressId.safeParse(
        "gaCZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
      ).success,
    ).toBe(false);
  });
});

describe("validate-params > validateParam", () => {
  it("returns success for a valid record id", () => {
    const result = validateParam(VALID_CUID, "record");
    expect(result.success).toBe(true);
    if (result.success) expect(result.id).toBe(VALID_CUID);
  });

  it("returns a 400 response with VALIDATION_ERROR for an invalid record id", async () => {
    const result = validateParam("not-a-cuid!", "record");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns success for a valid numeric id", () => {
    const result = validateParam("7", "numeric");
    expect(result.success).toBe(true);
    if (result.success) expect(result.id).toBe("7");
  });

  it("returns a 400 response for an invalid numeric id", async () => {
    const result = validateParam("not-a-number", "numeric");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
    }
  });

  it("returns success for a valid address", () => {
    const result = validateParam(VALID_ADDRESS, "address");
    expect(result.success).toBe(true);
    if (result.success) expect(result.id).toBe(VALID_ADDRESS);
  });

  it("returns a 400 response for an invalid address", async () => {
    const result = validateParam("not-an-address", "address");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
    }
  });

  it("defaults to the record schema when no kind is given", () => {
    const result = validateParam(VALID_CUID);
    expect(result.success).toBe(true);
  });

  it("rejects undefined input", () => {
    const result = validateParam(undefined, "record");
    expect(result.success).toBe(false);
  });
});

describe("validate-params > validateIdParam", () => {
  it("resolves the params promise and validates a valid record id", async () => {
    const result = await validateIdParam(Promise.resolve({ id: VALID_CUID }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.id).toBe(VALID_CUID);
  });

  it("returns a 400 response for an invalid record id", async () => {
    const result = await validateIdParam(
      Promise.resolve({ id: "bad id!" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
    }
  });

  it("validates a valid numeric id when kind is 'numeric'", async () => {
    const result = await validateIdParam(
      Promise.resolve({ id: "123" }),
      "numeric",
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.id).toBe("123");
  });

  it("rejects an invalid numeric id when kind is 'numeric'", async () => {
    const result = await validateIdParam(
      Promise.resolve({ id: "escrow-1" }),
      "numeric",
    );
    expect(result.success).toBe(false);
  });
});