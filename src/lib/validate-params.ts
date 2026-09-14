// SPDX-License-Identifier: MIT

import { z } from "zod";
import { errorResponse } from "@/lib/api-response";
import { ERROR_CODES } from "@/lib/error-codes";
import { stellarAddress } from "@/lib/validation-schemas";

/**
 * Shared route-param validation.
 *
 * Route params (`[id]` segments) were previously validated ad hoc per file —
 * some used `parseInt` + `isNaN`, some did no validation at all, and the
 * failure responses were inconsistent (some 404, some nothing). This module
 * centralizes that so every route returns the same 400 error envelope for
 * bad input, and invalid input never reaches a handler's business logic.
 *
 * Note on naming: the ticket for this refers to "UUID" params, but this
 * codebase's DB-backed records (`Payment`, `NotificationHook`, `Refund`, …)
 * use Prisma's `cuid()` ids, not UUIDs — see prisma/schema.prisma. `recordId`
 * below validates that actual format. Contract-backed resources (`Escrow`,
 * `Batch`, `Recurrence`, `Stream`) use on-chain u64 ids, validated by
 * `numericId`. `stellarAddressId` covers the (rarer) case of a Stellar
 * G-address used directly as a route param.
 */

// ── Param schemas ──────────────────────────────────────────────

/** Prisma `cuid()` ids: a lowercase `c` followed by 24 base36 characters. */
export const recordId = z
  .string()
  .regex(/^c[a-z0-9]{20,32}$/i, "Invalid ID format");

/** On-chain u64 identifiers (escrows, batches, recurring payments, streams). */
export const numericId = z
  .string()
  .regex(/^\d+$/, "Invalid ID — must be numeric")
  .refine((v) => Number.isSafeInteger(Number(v)), "ID is out of range");

/** Stellar account address, e.g. as a `[address]` route param. */
export const stellarAddressId = stellarAddress;

export type IdParamKind = "record" | "numeric" | "address";

const SCHEMAS: Record<IdParamKind, z.ZodType<string>> = {
  record: recordId,
  numeric: numericId,
  address: stellarAddressId,
};

export type ValidateParamResult =
  | { success: true; id: string }
  | { success: false; response: Response };

// ── Core validator ─────────────────────────────────────────────

/**
 * Validate a single raw param value against one of the shared schemas.
 * Returns the standard 400 validation-error envelope on failure.
 */
export function validateParam(
  value: string | undefined,
  kind: IdParamKind = "record",
): ValidateParamResult {
  const schema = SCHEMAS[kind];
  const result = schema.safeParse(value);

  if (!result.success) {
    return {
      success: false,
      response: errorResponse(
        ERROR_CODES.VALIDATION_ERROR,
        result.error.issues[0]?.message ?? "Invalid parameter",
        400,
      ),
    };
  }

  return { success: true, id: result.data };
}

/**
 * Convenience wrapper for the common Next.js App Router shape:
 * `{ params }: { params: Promise<{ id: string }> }`.
 *
 * Usage:
 *   const parsed = await validateIdParam(params);           // cuid record id
 *   const parsed = await validateIdParam(params, "numeric"); // on-chain id
 *   if (!parsed.success) return parsed.response;
 *   const { id } = parsed;
 */
export async function validateIdParam(
  params: Promise<{ id: string }>,
  kind: IdParamKind = "record",
): Promise<ValidateParamResult> {
  const { id } = await params;
  return validateParam(id, kind);
}