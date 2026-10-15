// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { formatProblemDetails, formatZodProblemDetails } from "@/lib/api-errors";
import { z } from "zod";

describe("RFC 7807 Problem Details Formatter", () => {
  it("formats standard RFC 7807 problem response with application/problem+json content-type", async () => {
    const res = formatProblemDetails({
      type: "https://api.ophirpay.com/errors/bad-request",
      title: "Bad Request",
      status: 400,
      detail: "Invalid parameters supplied",
      instance: "/api/payments",
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const json = await res.json();
    expect(json.type).toBe("https://api.ophirpay.com/errors/bad-request");
    expect(json.title).toBe("Bad Request");
    expect(json.status).toBe(400);
    expect(json.detail).toBe("Invalid parameters supplied");
    expect(json.instance).toBe("/api/payments");
  });

  it("formats Zod validation errors into structured invalidParams", async () => {
    const schema = z.object({
      amount: z.number().positive(),
      assetCode: z.string().min(1),
    });

    const parsed = schema.safeParse({ amount: -10, assetCode: "" });
    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      const res = formatZodProblemDetails(parsed.error, "/api/payments");
      expect(res.status).toBe(422);
      expect(res.headers.get("content-type")).toBe("application/problem+json");

      const json = await res.json();
      expect(json.title).toBe("Unprocessable Entity");
      expect(json.status).toBe(422);
      expect(Array.isArray(json.invalidParams)).toBe(true);
      expect(json.invalidParams.length).toBe(2);
      expect(json.invalidParams[0]).toHaveProperty("name");
      expect(json.invalidParams[0]).toHaveProperty("reason");
    }
  });

  it("defaults type URL when omitted", async () => {
    const res = formatProblemDetails({
      title: "Internal Error",
      status: 500,
      detail: "Unexpected error",
    });

    const json = await res.json();
    expect(json.type).toBe("https://api.ophirpay.com/errors/500");
    expect(res.status).toBe(500);
  });
});
