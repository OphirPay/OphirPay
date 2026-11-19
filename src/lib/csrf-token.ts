// SPDX-License-Identifier: MIT

/**
 * Edge-safe half of the double-submit CSRF implementation.
 *
 * `src/proxy.ts` (the Next.js 16 middleware entrypoint) runs on the Edge
 * runtime, where `node:crypto` and the Prisma-backed auth module are not
 * available. This module therefore contains only Web-platform primitives:
 * cookie/header parsing and a constant-time comparison. Token *minting* lives
 * in `src/lib/csrf.ts` and stays on the Node runtime.
 */

import { extractApiKey } from "@/lib/api-key-format";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const CSRF_COOKIE = "__Host-csrf";
/** Plain-http dev fallback — `__Host-` cookies are rejected without Secure. */
const CSRF_COOKIE_INSECURE = "csrf";
const CSRF_HEADER = "x-csrf-token";
export const CSRF_TOKEN_BYTES = 32;
export const CSRF_TOKEN_HEX_LENGTH = CSRF_TOKEN_BYTES * 2;

const TOKEN_HEX_RE = /^[0-9a-f]+$/;

/** Methods that can mutate state and therefore require a CSRF token. */
export function isMutatingMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

/**
 * Extract the CSRF token from the request cookie header.
 * Accepts both the `__Host-csrf` (https) and `csrf` (plain-http dev) names.
 */
export function getCsrfTokenFromCookies(
  cookieHeader: string | null
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)(?:${CSRF_COOKIE}|${CSRF_COOKIE_INSECURE})=([^;]*)`)
  );
  return match?.[1] ?? null;
}

/** Extract the CSRF token from the request header. */
export function getCsrfTokenFromHeaders(headers: Headers): string | null {
  return headers.get(CSRF_HEADER);
}

/**
 * Validate an incoming CSRF token against the cookie.
 *
 * Both values must be 32-byte hex strings. The comparison walks every
 * character (no early exit) so a crafted header cannot be distinguished from
 * a wrong one by response timing.
 */
export function validateCsrfToken(
  cookieToken: string | null,
  headerToken: string | null
): boolean {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== CSRF_TOKEN_HEX_LENGTH) return false;
  if (headerToken.length !== CSRF_TOKEN_HEX_LENGTH) return false;
  if (!TOKEN_HEX_RE.test(cookieToken) || !TOKEN_HEX_RE.test(headerToken)) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < CSRF_TOKEN_HEX_LENGTH; i += 1) {
    mismatch |= cookieToken.charCodeAt(i) ^ headerToken.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Whether the request carries a signed browser session cookie. */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

/**
 * Full double-submit check for a request.
 *
 * Returns true when the request is safe to pass:
 *   • it is a read-only method,
 *   • it authenticates with an API key / cron secret (custom headers cannot be
 *     attached cross-site without CORS preflight), or
 *   • the `x-csrf-token` header matches the CSRF cookie.
 *
 * The proxy calls this only for browser-session requests; route handlers call
 * `verifyCsrf()` in `src/lib/csrf.ts`, which shares this validation.
 */
export function verifyCsrfForRequest(request: Request): boolean {
  if (!isMutatingMethod(request.method)) return true;
  if (extractApiKey(request)) return true;
  if (request.headers.get("x-cron-secret")) return true;

  return validateCsrfToken(
    getCsrfTokenFromCookies(request.headers.get("cookie")),
    getCsrfTokenFromHeaders(request.headers)
  );
}

export { CSRF_HEADER, CSRF_COOKIE, CSRF_COOKIE_INSECURE };
