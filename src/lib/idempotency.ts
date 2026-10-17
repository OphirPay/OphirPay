// SPDX-License-Identifier: MIT

import crypto from "crypto";
import { z } from "zod";
import { conflictError, validationError } from "@/lib/api-response";

/** Default TTL for stored idempotency keys: 24 hours in milliseconds (#1302). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const IDEMPOTENCY_MIN_LENGTH = 8;
export const IDEMPOTENCY_MAX_LENGTH = 255;

/** Printable ASCII characters (0x20..0x7E), disallowing control characters and non-ASCII. */
const PRINTABLE_ASCII_REGEX = /^[\x20-\x7E]+$/;

/** UUID v4 format helper for callers that specifically check UUID v4 keys. */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requestIdempotencyKeySchema = z
  .string("Idempotency-Key must be a string")
  .trim()
  .min(
    IDEMPOTENCY_MIN_LENGTH,
    `Idempotency-Key must be at least ${IDEMPOTENCY_MIN_LENGTH} characters`,
  )
  .max(
    IDEMPOTENCY_MAX_LENGTH,
    `Idempotency-Key must be at most ${IDEMPOTENCY_MAX_LENGTH} ASCII characters`,
  )
  .refine((val) => PRINTABLE_ASCII_REGEX.test(val), {
    message: "Idempotency-Key must contain only printable ASCII characters",
  });

export interface StoredIdempotencyEntry {
  key: string;
  scope: string;
  userId: string;
  payloadHash: string;
  status: number;
  bodyText: string;
  contentType: string;
  createdAt: number;
  expiresAt: number;
}

const idempotencyStore = new Map<string, StoredIdempotencyEntry>();

function buildCompositeKey(scope: string, userId: string, key: string): string {
  return `${scope}:${userId}:${key}`;
}

/**
 * Canonical JSON serialization with sorted keys so semantically identical
 * JSON objects produce the exact same SHA-256 payload digest.
 */
function canonicalizePayload(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePayload(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const pairs = sortedKeys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizePayload(record[k])}`);
  return `{${pairs.join(",")}}`;
}

/**
 * Compute a deterministic SHA-256 hex digest of a request payload (#1302).
 */
export function computePayloadHash(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(canonicalizePayload(payload), "utf8")
    .digest("hex");
}

/**
 * Validate an `Idempotency-Key` header value (UUID v4 or 8..255 printable ASCII chars).
 */
export function validateIdempotencyKeyHeader(
  rawHeader: string | null,
): { ok: true; key: string | null } | { ok: false; errorResponse: Response } {
  if (rawHeader === null) {
    return { ok: true, key: null };
  }
  const parsed = requestIdempotencyKeySchema.safeParse(rawHeader);
  if (!parsed.success) {
    return { ok: false, errorResponse: validationError(parsed.error) };
  }
  return { ok: true, key: parsed.data };
}

/**
 * Purge expired idempotency entries from the store.
 */
export function purgeExpiredIdempotencyKeys(now: number = Date.now()): number {
  let removed = 0;
  for (const [compositeKey, entry] of idempotencyStore.entries()) {
    if (entry.expiresAt <= now) {
      idempotencyStore.delete(compositeKey);
      removed += 1;
    }
  }
  return removed;
}

export interface CheckIdempotencyInput {
  scope: string;
  userId: string;
  key: string;
  payload: unknown;
  now?: number;
}

export type CheckIdempotencyResult =
  | { status: "miss"; payloadHash: string }
  | { status: "hit"; response: Response; entry: StoredIdempotencyEntry }
  | { status: "conflict"; response: Response; entry: StoredIdempotencyEntry };

/**
 * Check whether an idempotency key has already been processed within the 24h TTL window.
 * - Returns `hit` with the cached response when key + payload hash match.
 * - Returns `conflict` (HTTP 409) when the key is reused with a different payload hash.
 * - Returns `miss` when the key has not been seen or has expired.
 */
export function checkIdempotencyKey(
  input: CheckIdempotencyInput,
): CheckIdempotencyResult {
  const now = input.now ?? Date.now();
  purgeExpiredIdempotencyKeys(now);

  const payloadHash = computePayloadHash(input.payload);
  const compositeKey = buildCompositeKey(input.scope, input.userId, input.key);
  const existing = idempotencyStore.get(compositeKey);

  if (!existing) {
    return { status: "miss", payloadHash };
  }

  if (existing.payloadHash !== payloadHash) {
    return {
      status: "conflict",
      entry: existing,
      response: conflictError(
        "Idempotency-Key has already been used with a different request payload.",
      ),
    };
  }

  const replayedResponse = new Response(existing.bodyText, {
    status: existing.status,
    headers: {
      "Content-Type": existing.contentType,
      "X-Idempotency-Key": existing.key,
      "X-Idempotency-Replayed": "true",
    },
  });

  return {
    status: "hit",
    entry: existing,
    response: replayedResponse,
  };
}

export interface StoreIdempotencyInput {
  scope: string;
  userId: string;
  key: string;
  payloadHash: string;
  response: Response;
  ttlMs?: number;
  now?: number;
}

/**
 * Persist a successful mutation response under the given idempotency key with a 24-hour TTL.
 */
export async function storeIdempotencyResponse(
  input: StoreIdempotencyInput,
): Promise<Response> {
  const {
    scope,
    userId,
    key,
    payloadHash,
    response,
    ttlMs = IDEMPOTENCY_TTL_MS,
    now = Date.now(),
  } = input;

  // Only cache 2xx responses so transient 4xx/5xx failures can be retried.
  if (response.status < 200 || response.status >= 300) {
    return response;
  }

  const cloned = response.clone();
  const bodyText = await cloned.text();
  const contentType = response.headers.get("Content-Type") || "application/json";

  const compositeKey = buildCompositeKey(scope, userId, key);
  idempotencyStore.set(compositeKey, {
    key,
    scope,
    userId,
    payloadHash,
    status: response.status,
    bodyText,
    contentType,
    createdAt: now,
    expiresAt: now + ttlMs,
  });

  const headers = new Headers(response.headers);
  headers.set("X-Idempotency-Key", key);
  return new Response(bodyText, {
    status: response.status,
    headers,
  });
}

/**
 * Clear all cached idempotency keys (for unit tests).
 */
export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
}
