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
  "batches:create",
  "batches:read",
  "batches:write",
  "escrow:read",
  "escrow:write",
  "escrow:release",
  "webhooks:read",
  "webhooks:write",
  "payments:read",
  "payments:write",
] as const;

export type ApiScope = (typeof API_SCOPES)[number] | (string & {});

export const ADMIN_SCOPE: ApiScope = "admin";

/** Scope alias mappings for compatibility with standard and namespaced forms. */
const SCOPE_ALIASES: Record<string, string[]> = {
  "batches:create": ["batches:write", "admin"],
  "batches:read": ["admin"],
  "batches:write": ["admin"],
  "escrow:write": ["admin"],
  "escrow:release": ["escrow:write", "admin"],
  "escrow:read": ["admin"],
  "webhooks:write": ["admin"],
  "webhooks:read": ["admin"],
  "write:payments": ["payments:write", "admin"],
  "payments:write": ["write:payments", "admin"],
  "read:payments": ["payments:read", "admin"],
  "payments:read": ["read:payments", "admin"],
};

/**
 * Whether a key's scopes satisfy a set of required scopes.
 * The `admin` scope satisfies any requirement. Empty `required` is always
 * satisfied. Every entry in `required` must be present (AND semantics).
 */
export function hasScope(
  keyScopes: string[] | null | undefined,
  required: ApiScope | ApiScope[]
): boolean {
  const requiredList = Array.isArray(required) ? required : [required];
  if (!requiredList.length) return true;
  const scopes = new Set(keyScopes ?? []);
  if (scopes.has(ADMIN_SCOPE)) return true;

  return requiredList.every((req) => {
    if (scopes.has(req)) return true;
    const aliases = SCOPE_ALIASES[req];
    if (aliases && aliases.some((a) => scopes.has(a))) return true;
    return false;
  });
}

/**
 * Identify missing scopes from a user's scope list.
 */
export function getMissingScopes(
  keyScopes: string[] | null | undefined,
  required: ApiScope | ApiScope[]
): string[] {
  const requiredList = Array.isArray(required) ? required : [required];
  const scopes = new Set(keyScopes ?? []);
  if (scopes.has(ADMIN_SCOPE)) return [];

  return requiredList.filter((req) => {
    if (scopes.has(req)) return false;
    const aliases = SCOPE_ALIASES[req];
    if (aliases && aliases.some((a) => scopes.has(a))) return false;
    return true;
  });
}
