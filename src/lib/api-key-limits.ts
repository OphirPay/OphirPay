// SPDX-License-Identifier: MIT

/**
 * Shared policy helpers for API-key lifecycle endpoints (#1370).
 *
 * The routes in `src/app/api/keys` guard two independent limits:
 *
 *   • a sliding hourly quota on create/rotate (charged by
 *     `consumeApiKeyMutationQuota` in `@/lib/rate-limit`), and
 *   • a hard cap on simultaneously active keys.
 *
 * Keeping the response shape and the "what counts as active" predicate here
 * (rather than duplicating them in both routes) means a future endpoint — e.g.
 * an admin re-issue flow — enforces exactly the same rules.
 */

import type { Prisma } from "@prisma/client";
import { conflictError, rateLimitError } from "@/lib/api-response";
import {
  MAX_ACTIVE_API_KEYS,
  type ApiKeyMutationQuota,
} from "@/lib/rate-limit";

/**
 * Prisma filter for keys that are currently usable and have not been replaced.
 *
 * "Active" deliberately excludes keys that were rotated: a rotated key keeps
 * working during its 24-hour overlap, but its replacement already occupies the
 * slot. Counting both would make a single rotation appear to consume two of
 * the five available keys and eventually block rotation entirely.
 */
export function activeApiKeyWhere(
  userId: string,
  now: Date = new Date()
): Prisma.ApiKeyWhereInput {
  return {
    userId,
    revokedAt: null,
    rotatedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * 429 response for an exhausted create/rotate quota.
 *
 * Carries the reset time both as a `Retry-After` header (for generic HTTP
 * clients) and as `details.resetAt` in the body (for the dashboard and API
 * consumers that need to display "try again at …" without parsing headers).
 */
export function apiKeyQuotaError(quota: ApiKeyMutationQuota) {
  const resetAt = new Date(quota.resetAt);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((quota.resetAt - Date.now()) / 1000)
  );

  return rateLimitError(
    `API key operation limit reached (${quota.limit} per hour). Try again after ${resetAt.toISOString()}.`,
    retryAfterSeconds,
    {
      "X-RateLimit-Limit": String(quota.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Math.ceil(quota.resetAt / 1000)),
    },
    {
      limit: quota.limit,
      remaining: 0,
      resetAt: resetAt.toISOString(),
    }
  );
}

/**
 * 409 response for an account that already holds the maximum number of keys.
 *
 * This is a state conflict, not a rate problem: retrying later will not help
 * until the caller revokes or rotates a key, so 409 is more actionable than
 * another 429.
 */
export function apiKeyLimitError() {
  return conflictError(
    `Maximum of ${MAX_ACTIVE_API_KEYS} active API keys reached. Revoke an existing key before creating another.`
  );
}

/**
 * True for a transient serialization/deadlock failure.
 *
 * The account-wide key cap is enforced by counting inside a Serializable
 * transaction. Two concurrent creates can collide; Prisma surfaces that as
 * `P2034`, and the correct response is to retry the whole transaction so the
 * second request observes the first key and is rejected by the cap.
 */
export function isRetryableTransactionError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2034"
  );
}

/**
 * Who initiated a key lifecycle change, for the audit trail.
 *
 * A user can act through a wallet session or through an existing API key; both
 * resolve to the same `userId`, so recording only that loses the distinction
 * needed to investigate a compromised credential.
 */
export function describeKeyInitiator(auth: {
  userId: string;
  publicKey?: string;
  keyId?: string;
}): string {
  if (auth.keyId) return `api_key:${auth.keyId}`;
  if (auth.publicKey) return `wallet:${auth.publicKey}`;
  return `user:${auth.userId}`;
}
