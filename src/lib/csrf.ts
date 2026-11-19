// SPDX-License-Identifier: MIT

import { randomBytes } from "crypto";
import { extractApiKey } from "@/lib/api-key-format";
import {
  CSRF_COOKIE,
  CSRF_COOKIE_INSECURE,
  CSRF_TOKEN_BYTES,
  getCsrfTokenFromCookies,
  getCsrfTokenFromHeaders,
  validateCsrfToken,
} from "@/lib/csrf-token";

// Re-export the edge-safe helpers so existing callers keep one import site.
export {
  CSRF_COOKIE,
  CSRF_COOKIE_INSECURE,
  CSRF_TOKEN_BYTES,
  CSRF_TOKEN_HEX_LENGTH,
  getCsrfTokenFromCookies,
  getCsrfTokenFromHeaders,
  validateCsrfToken,
} from "@/lib/csrf-token";

/**
 * Generate a cryptographically random CSRF token.
 * Uses CSPRNG (crypto.randomBytes) — suitable for production.
 */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString("hex");
}

/**
 * Create a CSRF cookie header value (HttpOnly, SameSite=Lax, Max-Age=86400).
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
  const secureAttr = secure ? "Secure; " : "";
  // `SameSite=Lax` still blocks the cross-site POSTs this token guards against,
  // while surviving top-level navigations back into the dashboard (Strict would
  // withhold the cookie on that first request, forcing an unnecessary re-mint).
  return `${name}=${token}; Path=/; ${secureAttr}HttpOnly; SameSite=Lax; Max-Age=86400`;
}

/**
 * Verify CSRF token for a mutation request.
 * Returns null if valid, or a 403 Response if invalid.
 */
export function verifyCsrf(request: Request): Response | null {
  // Skip CSRF check for GET/HEAD/OPTIONS
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;

  // API keys are sent explicitly in headers — browsers never attach them on
  // cross-site requests, so CSRF does not apply to machine-to-machine calls.
  if (extractApiKey(request)) return null;
  // Cron/scheduler secrets travel the same way (Authorization: Bearer or the
  // `x-cron-secret` header) — custom headers can't be attached cross-site
  // without CORS preflight, so they are equally safe from CSRF.
  if (request.headers.get("x-cron-secret")) return null;

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

/**
 * Higher-order function to wrap API route handlers with CSRF protection.
 * Automatically enforces CSRF for mutating methods.
 * 
 * Usage:
 * ```typescript
 * export const POST = withCsrf(async (request) => {
 *   // ... handle request
 * });
 * ```
 */
export function withCsrf<TContext = undefined>(
  handler: (request: Request, context?: TContext) => Promise<Response>
) {
  return async (request: Request, context?: TContext): Promise<Response> => {
    const csrfError = verifyCsrf(request);
    if (csrfError) return csrfError;
    return handler(request, context);
  };
}

/**
 * Audit helper: Check if a route handler has CSRF protection.
 * This is a utility for tests and code review, not runtime enforcement.
 */
export function auditRouteProtection(
  method: string,
  hasProtection: boolean
): { method: string; isMutating: boolean; isProtected: boolean } {
  const isMutating = ["POST", "PATCH", "DELETE", "PUT"].includes(method.toUpperCase());
  return {
    method: method.toUpperCase(),
    isMutating,
    isProtected: isMutating ? hasProtection : true,
  };
}

/**
 * List of all API routes and their CSRF protection status.
 * This is used by tests to verify no mutating route is unprotected.
 * Add routes here as they are audited.
 */
export const CSRF_ROUTE_AUDIT = {
  // Auth routes
  "/api/auth/session": { POST: true, DELETE: true },
  "/api/auth/challenge": { GET: true },
  
  // CSRF token minting
  "/api/csrf": { GET: true },
  
  // Add more routes as they are audited:
  // "/api/payments": { POST: true, PATCH: true, DELETE: true },
  // "/api/webhooks": { POST: true, PATCH: true, DELETE: true },
} as const;

/**
 * Find any mutating routes that lack CSRF protection.
 * Returns an array of "METHOD /path" strings for unprotected routes.
 */
export function findUnprotectedRoutes(): string[] {
  const unprotected: string[] = [];
  
  for (const [path, methods] of Object.entries(CSRF_ROUTE_AUDIT)) {
    for (const [method, isProtected] of Object.entries(methods)) {
      const audit = auditRouteProtection(method, isProtected);
      if (audit.isMutating && !audit.isProtected) {
        unprotected.push(`${audit.method} ${path}`);
      }
    }
  }
  
  return unprotected;
}