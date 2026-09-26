// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  ERROR_TAXONOMY,
  getTaxonomyEntry,
  formatErrorMessage,
  createTaxonomyError,
  type ErrorTaxonomyEntry,
} from "@/lib/error-taxonomy";
import { ERROR_CODES, ERROR_STATUS } from "@/lib/error-codes";
import { ERROR_MESSAGES, getErrorMessage } from "@/lib/error-messages";
import { parseContractError, decodeContractError } from "@/lib/contract-errors";
import { parseStellarError, getStellarErrorMessage } from "@/lib/stellar-error";
import { handlePrismaError, parsePrismaError } from "@/lib/prisma-errors";
import {
  serializeErrorEnvelope,
  errorResponse,
  handleApiError,
  type ApiErrorEnvelope,
} from "@/lib/api-response";
import { Prisma } from "@prisma/client";
import { z } from "zod";

describe("Unified Error Taxonomy", () => {
  // ── 1. Taxonomy Completeness & Derivation ──────────────────────
  describe("Taxonomy completeness and status derivation", () => {
    it("every entry in ERROR_TAXONOMY has a code, valid HTTP status, and message", () => {
      const entries = Object.entries(ERROR_TAXONOMY);
      expect(entries.length).toBeGreaterThan(150);

      for (const [key, entry] of entries) {
        expect(entry.code).toBe(key);
        expect(typeof entry.status).toBe("number");
        expect(entry.status).toBeGreaterThanOrEqual(400);
        expect(entry.status).toBeLessThan(600);
        expect(typeof entry.message).toBe("string");
        expect(entry.message.trim().length).toBeGreaterThan(0);
      }
    });

    it("ERROR_CODES is derived directly from ERROR_TAXONOMY", () => {
      const taxonomyKeys = Object.keys(ERROR_TAXONOMY);
      const codeKeys = Object.keys(ERROR_CODES);
      expect(codeKeys.sort()).toEqual(taxonomyKeys.sort());

      for (const key of taxonomyKeys) {
        expect(ERROR_CODES[key as keyof typeof ERROR_CODES]).toBe(key);
      }
    });

    it("ERROR_STATUS is derived directly from ERROR_TAXONOMY", () => {
      for (const [key, entry] of Object.entries(ERROR_TAXONOMY)) {
        expect(ERROR_STATUS[key]).toBe(entry.status);
      }
    });

    it("ERROR_MESSAGES contains messages for taxonomy keys", () => {
      expect(getErrorMessage("NOT_FOUND")).toBe(ERROR_TAXONOMY.NOT_FOUND.message);
      expect(getErrorMessage("BAD_REQUEST")).toBe(ERROR_TAXONOMY.BAD_REQUEST.message);
      expect(getErrorMessage("UNAUTHORIZED")).toBe(ERROR_TAXONOMY.UNAUTHORIZED.message);
    });

    it("getTaxonomyEntry retrieves entry by code or returns undefined", () => {
      const entry = getTaxonomyEntry("NOT_FOUND");
      expect(entry).toBeDefined();
      expect(entry?.code).toBe("NOT_FOUND");
      expect(entry?.status).toBe(404);

      expect(getTaxonomyEntry("NON_EXISTENT_CODE")).toBeUndefined();
    });

    it("adding a new error to taxonomy allows status and codes to be derived from a single table", () => {
      const mockTable: Record<string, ErrorTaxonomyEntry> = {
        ...ERROR_TAXONOMY,
        CUSTOM_TEST_ERROR: {
          code: "CUSTOM_TEST_ERROR",
          status: 418,
          message: "I am a teapot",
          category: "test",
        },
      };

      const derivedCodes = Object.fromEntries(Object.keys(mockTable).map((k) => [k, k]));
      const derivedStatus = Object.fromEntries(
        Object.values(mockTable).map((e) => [e.code, e.status])
      );

      expect(derivedCodes.CUSTOM_TEST_ERROR).toBe("CUSTOM_TEST_ERROR");
      expect(derivedStatus.CUSTOM_TEST_ERROR).toBe(418);
    });
  });

  // ── 2. Parameter Interpolation ────────────────────────────────
  describe("Message templating and parameter interpolation", () => {
    it("formatErrorMessage replaces {keys} with provided params", () => {
      const template = "Amount must be between {min} and {max} for {currency}";
      const formatted = formatErrorMessage(template, { min: 5, max: 100, currency: "XLM" });
      expect(formatted).toBe("Amount must be between 5 and 100 for XLM");
    });

    it("formatErrorMessage leaves unsupplied placeholders intact", () => {
      const template = "Field {name} is missing, required by {parent}";
      const formatted = formatErrorMessage(template, { name: "email" });
      expect(formatted).toBe("Field email is missing, required by {parent}");
    });

    it("createTaxonomyError builds an error with formatted message", () => {
      const err = createTaxonomyError("MISSING_REQUIRED_FIELD", { field: "destination" });
      expect(err.code).toBe("MISSING_REQUIRED_FIELD");
      expect(err.status).toBe(400);
      expect(err.message).toBe("Missing required field: destination");
      expect(err.details).toEqual({ field: "destination" });
    });
  });

  // ── 3. Upstream Error Parsers Produce Taxonomy Entries ───────
  describe("Upstream error parsers map into taxonomy", () => {
    describe("Soroban contract errors (contract-errors.ts)", () => {
      it("parseContractError produces ErrorTaxonomyEntry for error code string", () => {
        const classified = parseContractError("1");
        expect(classified.code).toBe("INTERNAL_ERROR");
        expect(classified.status).toBe(500);
        expect(classified.contractCode).toBe("1");
        expect(classified.message).toBe("Contract not initialized: call init() first");
      });

      it("parseContractError parses Error(Contract, #N) pattern", () => {
        const raw = "HostError: Error(Contract, #16)";
        const classified = parseContractError(raw);
        expect(classified.code).toBe("INSUFFICIENT_FUNDS");
        expect(classified.status).toBe(402);
        expect(classified.contractCode).toBe("16");
        expect(classified.message).toContain("Insufficient balance");
      });

      it("decodeContractError returns the message from parseContractError", () => {
        const msg = decodeContractError("Error(Contract, #4)");
        expect(msg).toBe("Unauthorized: caller does not have permission");
      });

      it("handles unknown contract errors with fallback taxonomy entry", () => {
        const classified = parseContractError("Error(Contract, #99999)");
        expect(classified.code).toBe("CONTRACT_ERROR");
        expect(classified.status).toBe(500);
      });
    });

    describe("Stellar Horizon errors (stellar-error.ts)", () => {
      it("parseStellarError produces ClassifiedStellarError with taxonomy fields", () => {
        const classified = parseStellarError("op_underfunded");
        expect(classified.code).toBe("INSUFFICIENT_FUNDS");
        expect(classified.status).toBe(402);
        expect(classified.recoverable).toBe(true);
        expect(classified.message).toContain("Insufficient funds");
      });

      it("parseStellarError classifies non-recoverable errors", () => {
        const classified = parseStellarError("op_no_issuer");
        expect(classified.code).toBe("ASSET_NOT_FOUND");
        expect(classified.status).toBe(404);
        expect(classified.recoverable).toBe(false);
      });

      it("getStellarErrorMessage delegates to parseStellarError", () => {
        const msg = getStellarErrorMessage("tx_bad_seq");
        expect(msg).toContain("Transaction sequence number is invalid");
      });
    });

    describe("Prisma errors (prisma-errors.ts)", () => {
      it("handlePrismaError maps P2002 to UNIQUE_CONSTRAINT (409)", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = new (Prisma.PrismaClientKnownRequestError as any)("unique constraint", {
          code: "P2002",
          clientVersion: "5.0",
          meta: { target: ["walletAddress"] },
        });
        const classified = handlePrismaError(err);
        expect(classified.code).toBe("UNIQUE_CONSTRAINT");
        expect(classified.status).toBe(409);
        expect(classified.prismaCode).toBe("P2002");
        expect(classified.message).toContain("walletAddress already exists");
      });

      it("handlePrismaError maps P2025 to NOT_FOUND (404)", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = new (Prisma.PrismaClientKnownRequestError as any)("not found", {
          code: "P2025",
          clientVersion: "5.0",
        });
        const classified = handlePrismaError(err);
        expect(classified.code).toBe("NOT_FOUND");
        expect(classified.status).toBe(404);
        expect(classified.prismaCode).toBe("P2025");
      });

      it("handlePrismaError maps P2003 to FOREIGN_KEY (400)", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = new (Prisma.PrismaClientKnownRequestError as any)("fk error", {
          code: "P2003",
          clientVersion: "5.0",
        });
        const classified = handlePrismaError(err);
        expect(classified.code).toBe("FOREIGN_KEY");
        expect(classified.status).toBe(400);
      });

      it("handlePrismaError maps P2014 to RELATION_VIOLATION (409)", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err = new (Prisma.PrismaClientKnownRequestError as any)("relation error", {
          code: "P2014",
          clientVersion: "5.0",
        });
        const classified = handlePrismaError(err);
        expect(classified.code).toBe("RELATION_VIOLATION");
        expect(classified.status).toBe(409);
      });

      it("parsePrismaError is an alias for handlePrismaError", () => {
        expect(parsePrismaError).toBe(handlePrismaError);
      });
    });
  });

  // ── 4. Error Envelope Serializer (api-response.ts) ───────────
  describe("Sole error envelope serializer", () => {
    it("serializeErrorEnvelope formats standard API error response envelope", () => {
      const envelope: ApiErrorEnvelope = serializeErrorEnvelope("INVALID_ADDRESS");
      expect(envelope.success).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ADDRESS");
      expect(envelope.error.message).toBe(ERROR_TAXONOMY.INVALID_ADDRESS.message);
      expect(typeof envelope.timestamp).toBe("string");
      expect(new Date(envelope.timestamp).getTime()).not.toBeNaN();
    });

    it("serializeErrorEnvelope includes details when provided", () => {
      const envelope = serializeErrorEnvelope("VALIDATION_ERROR", "Validation failed", {
        field: "amount",
      });
      expect(envelope.error.details).toEqual({ field: "amount" });
    });

    it("errorResponse uses serializeErrorEnvelope and resolves status from taxonomy", async () => {
      const res = errorResponse("RATE_LIMITED");
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("RATE_LIMITED");
      expect(json.error.message).toBe(ERROR_TAXONOMY.RATE_LIMITED.message);
    });

    it("handleApiError automatically dispatches Soroban contract errors through serializer", async () => {
      const contractErr = new Error("Transaction simulation failed: HostError: Error(Contract, #16)");
      const res = handleApiError(contractErr);
      expect(res.status).toBe(402);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("INSUFFICIENT_FUNDS");
    });

    it("handleApiError automatically dispatches Stellar Horizon errors through serializer", async () => {
      const stellarErr = {
        result_codes: {
          transaction: "tx_bad_seq",
        },
      };
      const res = handleApiError(stellarErr);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("SEQUENCE_NUMBER_MISMATCH");
    });

    it("handleApiError handles direct classified taxonomy entries", async () => {
      const entry = {
        code: "ESCROW_EXPIRED",
        status: 400,
        message: "Escrow has expired",
      };
      const res = handleApiError(entry);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("ESCROW_EXPIRED");
      expect(json.error.message).toBe("Escrow has expired");
    });
  });
});
