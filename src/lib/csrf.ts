// SPDX-License-Identifier: MIT

import { randomBytes, timingSafeEqual } from "crypto";

const CSRF_COOKIE = "__Host-csrf";
/** Plain-http dev fallback — `__Host-` cookies are rejected without Secure. */
const CSRF_COOKIE_INSECURE = "csrf";
const CSRF_HEADER = "x-csrf-token";
const TOKEN_BYTES = 32;

/**
 * Generate a cryptographically random CSRF token.
 * Uses CSPRNG (crypto.randomBytes) — suitable for production.
 */
export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Create a CSRF cookie header value (HttpOnly, SameSite=Strict, Max-Age=86400).
 *
 * Over HTTPS the cookie is named `__Host-csrf` with `Secure` (the strongest
 * form — the prefix mandates Secure, no Domain, and Path=/). Over plain http
 * in development a plain `csrf` cookie is used instead: browsers reject both
 * Secure cookies AND `__Host-`-prefixed cookies without Secure on non-localhost
 * http origins, which would otherwise break every mutation for developers
 * running on a LAN IP.
 */
export function csrfCookieHeader(token: string, secure = true): string {
  const name = secure ? CSRF_COOKIE : CSRF_COOKIE_INSECURE;
  const secureAttr = secure ? "; Secure" : "";
  return `${name}=${token}; Path=/;${secureAttr} HttpOnly; SameSite=Strict; Max-Age=86400`;
}

/**
 * Validate an incoming CSRF token against the cookie.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns true if tokens match, false otherwise.
 */
export function validateCsrfToken(cookieToken: string | null, headerToken: string | null): boolean {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length !== TOKEN_BYTES * 2) return false;
  if (headerToken.length !== TOKEN_BYTES * 2) return false;

  const cookieBuf = Buffer.from(cookieToken, "hex");
  const headerBuf = Buffer.from(headerToken, "hex");

  try {
    return timingSafeEqual(cookieBuf, headerBuf);
  } catch {
    return false;
  }
}

/**
 * Extract the CSRF token from the request cookie header.
 * Accepts both the `__Host-csrf` (https) and `csrf` (plain-http dev) names.
 */
export function getCsrfTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)(?:${CSRF_COOKIE}|${CSRF_COOKIE_INSECURE})=([^;]*)`)
  );
  return match?.[1] ?? null;
}

/**
 * Extract the CSRF token from the request header.
 */
export function getCsrfTokenFromHeaders(headers: Headers): string | null {
  return headers.get(CSRF_HEADER);
}

/**
 * Verify CSRF token for a mutation request.
 * Returns null if valid, or a 403 Response if invalid.
 */
export function verifyCsrf(request: Request): Response | null {
  // Skip CSRF check for GET/HEAD/OPTIONS
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;

  const cookieToken = getCsrfTokenFromCookies(request.headers.get("cookie"));
  const headerToken = getCsrfTokenFromHeaders(request.headers);

  if (!validateCsrfToken(cookieToken, headerToken)) {
    return Response.json(
      {
        success: false,
        error: {
          code: "CSRF_INVALID",
          message: "Invalid or missing CSRF token. Refresh the page and try again.",
        },
      },
      { status: 403 },
    );
  }

  return null;
}
