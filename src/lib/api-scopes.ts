// SPDX-License-Identifier: MIT

// ── Scopes ─────────────────────────────────────────────────────
//
// Client-safe: this module must stay free of server-only imports (prisma,
// next/headers, node:*). Client components (e.g. the keys page) import
// API_SCOPES / ApiScope from here; server code gets the same symbols via
// @/lib/api-auth, which re-exports them.

/**
 * API key scopes. Each key carries a set of these; routes declare the scope(s)
 * they require and requests are denied (403) when the key lacks them.
 * The `admin` scope implicitly grants every other scope.
 *
 * `read:payments` / `write:payments` / `read:analytics` are the original
 * coarse scopes and remain valid for existing keys. The granular scopes below
 * let an integration be delegated the narrowest permission it needs:
 * `payments:write` for payment mutations, `batches:create` for batch creation,
 * `escrow:write` / `escrow:release` for escrow mutations, and
 * `webhooks:write` for webhook configuration.
 */
export const API_SCOPES = [
  "read:payments",
  "write:payments",
  "payments:write",
  "batches:create",
  "escrow:write",
  "escrow:release",
  "webhooks:write",
  "read:analytics",
  "admin",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const ADMIN_SCOPE: ApiScope = "admin";

/**
 * Whether a key's scopes satisfy a set of required scopes.
 * The `admin` scope satisfies any requirement. Empty `required` is always
 * satisfied. Every entry in `required` must be present (AND semantics).
 */
export function hasScope(
  keyScopes: string[] | null | undefined,
  required: ApiScope[]
): boolean {
  if (!required.length) return true;
  const scopes = new Set(keyScopes ?? []);
  if (scopes.has(ADMIN_SCOPE)) return true;
  return required.every((s) => scopes.has(s));
}

/**
 * Scopes a key is missing from `required`, in declaration order. Used to name
 * the exact permission in an INSUFFICIENT_SCOPE response instead of echoing a
 * generic "forbidden".
 */
export function missingScopes(
  keyScopes: string[] | null | undefined,
  required: ApiScope[]
): ApiScope[] {
  const scopes = new Set(keyScopes ?? []);
  if (scopes.has(ADMIN_SCOPE)) return [];
  return required.filter((s) => !scopes.has(s));
}
