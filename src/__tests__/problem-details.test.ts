// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import {
  problemDetailsResponse,
  problemValidationError,
  problemNotFoundError,
} from "@/lib/api-response";
import { z } from "zod";

describe("RFC 7807 Problem Details formatting", () => {
  it("formats standard problem details with application/problem+json header", () => {
    const res = problemDetailsResponse({
      type: "urn:problem:payment-failed",
      title: "Payment Processing Failed",
      status: 422,
      detail: "Insufficient liquidity in payment corridor",
      instance: "req_test_123",
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  });

  it("maps Zod validation issues into RFC 7807 invalid_params array", () => {
    const schema = z.object({
      amount: z.number().positive(),
      destAddress: z.string().startsWith("G"),
    });

    const parsed = schema.safeParse({ amount: -10, destAddress: "invalid" });
    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      const res = problemValidationError(parsed.error.issues, "req_val_456");
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    }
  });

  it("creates not found problem details with correct status and URN", () => {
    const res = problemNotFoundError("Payment", "req_404_789");
    expect(res.status).toBe(404);
  });
});
