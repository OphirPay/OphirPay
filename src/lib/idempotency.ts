// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { badRequestError, jsonSafe } from "@/lib/api-response";
import { idempotencyKeySchema } from "@/lib/validation-schemas";

/**
 * Standard TTL for request idempotency keys: 24 hours (issue #1302).
 * Keys older than 24 hours expire and are evicted to prevent unbounded storage growth.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const IDEMPOTENCY_HEADER = "idempotency-key";

export interface IdempotencyRecord {
  key: string;
  scope: string;
  userId?: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: number;
  expiresAt: number;
}

// In-memory L1 cache with 24-hour expiration support
const inMemoryStore = new Map<string, IdempotencyRecord>();

function buildStorageKey(key: string, scope: string, userId?: string): string {
  return `${scope}:${userId ?? "global"}:${key}`;
}

/**
 * Clean up expired keys from the store.
 */
export function cleanExpiredIdempotencyKeys(now = Date.now()): number {
  let evicted = 0;
  for (const [k, record] of inMemoryStore.entries()) {
    if (now >= record.expiresAt) {
      inMemoryStore.delete(k);
      evicted++;
    }
  }
  return evicted;
}

/**
 * Clear the entire idempotency store. Intended for test isolation.
 */
export function clearIdempotencyStore(): void {
  inMemoryStore.clear();
}

/**
 * Get an existing idempotency record if present and not expired.
 */
export async function getIdempotencyRecord(
  key: string,
  scope: string,
  userId?: string
): Promise<IdempotencyRecord | null> {
  const storageKey = buildStorageKey(key, scope, userId);
  const record = inMemoryStore.get(storageKey);
  if (!record) return null;

  if (Date.now() >= record.expiresAt) {
    inMemoryStore.delete(storageKey);
    return null;
  }

  return record;
}

/**
 * Save a response against an idempotency key with a 24-hour TTL.
 */
export async function saveIdempotencyRecord(
  key: string,
  scope: string,
  responseBody: unknown,
  statusCode = 200,
  userId?: string,
  ttlMs = IDEMPOTENCY_TTL_MS
): Promise<IdempotencyRecord> {
  const now = Date.now();
  const storageKey = buildStorageKey(key, scope, userId);
  const record: IdempotencyRecord = {
    key,
    scope,
    userId,
    statusCode,
    responseBody: jsonSafe(responseBody),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  inMemoryStore.set(storageKey, record);
  return record;
}

/**
 * Builds the HTTP 409 Conflict response containing the original cached response body (issue #1302).
 */
export function createIdempotencyConflictResponse(record: IdempotencyRecord): Response {
  return NextResponse.json(record.responseBody, {
    status: 409,
    headers: {
      "X-Idempotency-Status": "CONFLICT",
      "X-Idempotency-Key": record.key,
    },
  });
}

export type IdempotencyValidationResult =
  | { success: true; key: string }
  | { success: false; response: Response };

/**
 * Extracts and validates the Idempotency-Key header from a mutation request.
 * Enforces requirement and 8-255 char length.
 */
export function validateIdempotencyHeader(request: Request): IdempotencyValidationResult {
  const rawKey = request.headers.get(IDEMPOTENCY_HEADER);
  if (!rawKey || !rawKey.trim()) {
    return {
      success: false,
      response: badRequestError("Idempotency-Key header is required"),
    };
  }

  const parseResult = idempotencyKeySchema.safeParse(rawKey);
  if (!parseResult.success) {
    return {
      success: false,
      response: badRequestError(
        parseResult.error.issues[0]?.message || "Invalid Idempotency-Key format"
      ),
    };
  }

  return { success: true, key: parseResult.data };
}

/**
 * High-level gate for POST mutation routes:
 * 1. Requires and validates the Idempotency-Key header.
 * 2. Checks if a record already exists within the 24h window.
 * 3. If duplicate, returns HTTP 409 with original response body.
 */
export async function checkIdempotency(
  request: Request,
  scope: string,
  userId?: string
): Promise<
  | { isDuplicate: true; conflictResponse: Response; key: string }
  | { isDuplicate: false; key: string }
  | { errorResponse: Response }
> {
  const validation = validateIdempotencyHeader(request);
  if (!validation.success) {
    return { errorResponse: validation.response };
  }

  const { key } = validation;
  const existing = await getIdempotencyRecord(key, scope, userId);
  if (existing) {
    return {
      isDuplicate: true,
      conflictResponse: createIdempotencyConflictResponse(existing),
      key,
    };
  }

  return { isDuplicate: false, key };
}
