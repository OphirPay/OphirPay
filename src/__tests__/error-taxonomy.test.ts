// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #760 — the five overlapping error-handling modules were consolidated
 * behind one taxonomy. These tests pin the acceptance criteria:
 *
 *   • every code has a status and a message,
 *   • `ERROR_CODES`/`ERROR_STATUS` are derived from the taxonomy, and
 *   • the response serializer is the only writer of the error envelope.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  ERROR_STATUS,
  ERROR_TAXONOMY,
  errorEnvelope,
  errorMessage,
  errorStatus,
  getErrorDefinition,
} from "@/lib/error-codes";
import { errorResponse } from "@/lib/api-response";
import { classifyStellarError } from "@/lib/stellar-error";
import { classifyContractError } from "@/lib/error-messages";
import { handlePrismaError } from "@/lib/prisma-errors";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("error taxonomy (#760)", () => {
  it("gives every code a status and a non-empty message", () => {
    const entries = Object.values(ERROR_TAXONOMY);
    expect(entries.length).toBeGreaterThanOrEqual(200);
    for (const entry of entries) {
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(typeof entry.message).toBe("string");
      expect(entry.message.trim().length).toBeGreaterThan(0);
    }
  });

  it("derives ERROR_CODES and ERROR_STATUS from the one table", () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
      expect(ERROR_STATUS[key]).toBe(ERROR_TAXONOMY[value as keyof typeof ERROR_TAXONOMY].status);
    }
    // No stray status entries.
    for (const key of Object.keys(ERROR_STATUS)) {
      expect(ERROR_CODES[key as keyof typeof ERROR_CODES]).toBe(key);
    }
  });

  it("exposes helpers that agree with the table", () => {
    expect(errorStatus(ERROR_CODES.PAYMENT_NOT_FOUND)).toBe(404);
    expect(errorMessage(ERROR_CODES.PAYMENT_NOT_FOUND)).toBe("The payment was not found.");
    expect(getErrorDefinition("NOT_A_REAL_CODE").code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  it("classifies upstream failures as taxonomy entries", () => {
    const stellar = classifyStellarError("op_underfunded");
    expect(stellar.code).toBe(ERROR_CODES.HORIZON_ERROR);
    expect(stellar.status).toBeGreaterThanOrEqual(400);

    const contract = classifyContractError("Error(Contract, #1)");
    expect(contract.code).toBe(ERROR_CODES.CONTRACT_ERROR);
    expect(contract.message).toContain("initialized");

    const prisma = handlePrismaError(
      new Prisma.PrismaClientKnownRequestError("fk", {
        code: "P2003",
        clientVersion: "6.19.3",
      }),
    );
    expect(prisma.code).toBe(ERROR_CODES.FOREIGN_KEY);
    expect(prisma.status).toBe(ERROR_STATUS[ERROR_CODES.FOREIGN_KEY]);
  });
});

describe("single error envelope serializer (#760)", () => {
  it("builds the canonical envelope shape", () => {
    const env = errorEnvelope("BAD_REQUEST", "nope");
    expect(env.success).toBe(false);
    expect(env.error.code).toBe("BAD_REQUEST");
    expect(env.error.message).toBe("nope");
    expect(typeof env.timestamp).toBe("string");
  });

  it("api-response serializes through errorEnvelope", async () => {
    const res = errorResponse("BAD_REQUEST", "nope", 400);
    const json = await res.json();
    expect(json).toMatchObject({
      success: false,
      error: { code: "BAD_REQUEST", message: "nope" },
    });
  });

  it("only error-codes.ts writes the envelope inline", () => {
    const delegated = [
      "src/lib/api-response.ts",
      "src/lib/prisma-errors.ts",
      "src/lib/stellar-error.ts",
      "src/lib/error-messages.ts",
      "src/lib/rate-limit.ts",
    ];
    for (const file of delegated) {
      expect(read(file)).not.toContain("success: false");
    }
    expect(read("src/lib/error-codes.ts")).toContain("success: false");
  });

  it("the edge proxy serializes through errorEnvelope", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toContain("errorEnvelope");
    expect(proxy).not.toContain("success: false");
  });
});
