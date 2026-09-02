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
 */
export const API_SCOPES = [
  "read:payments",
  "write:payments",
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
