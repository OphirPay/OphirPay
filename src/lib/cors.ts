// SPDX-License-Identifier: MIT

/**
 * Strict CORS Configuration & Validation (issue #1393)
 *
 * Enforces strict origin allowlist validation across public API endpoints.
 * Guarantees that:
 * 1. Only explicitly configured origins can access credentialed endpoints.
 * 2. Wildcard '*' is NEVER returned alongside Access-Control-Allow-Credentials: true.
 * 3. Preflight OPTIONS requests from untrusted origins are rejected without Access-Control-Allow-Origin.
 * 4. Cross-origin mutation requests (POST, PUT, DELETE, PATCH) from unauthorized origins are rejected with HTTP 403.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const DEFAULT_ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
];

export const DEFAULT_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-API-Key",
  "X-Request-Id",
];

export const CORS_MAX_AGE_SECONDS = 86400;

export const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * Normalizes an origin string by trimming whitespace and removing trailing slashes.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/**
 * Parses the ALLOWED_ORIGINS environment variable into an explicit Set of allowed domain origins.
 * Falls back to defaultAppUrl (NEXT_PUBLIC_APP_URL or http://localhost:3000) if ALLOWED_ORIGINS is unset.
 */
export function parseAllowedOrigins(
  envAllowedOrigins = process.env.ALLOWED_ORIGINS,
  defaultAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
): Set<string> {
  const allowed = new Set<string>();

  if (envAllowedOrigins && envAllowedOrigins.trim().length > 0) {
    const split = envAllowedOrigins.split(",");
    for (const item of split) {
      const trimmed = normalizeOrigin(item);
      // Wildcard '*' is never added to the allowed domain origins set
      if (trimmed && trimmed !== "*") {
        allowed.add(trimmed);
      }
    }
  }

  // Include defaultAppUrl if available and valid
  if (defaultAppUrl) {
    const trimmedApp = normalizeOrigin(defaultAppUrl);
    if (trimmedApp && trimmedApp !== "*") {
      allowed.add(trimmedApp);
    }
  }

  return allowed;
}

/**
 * Validates whether a given origin is in the allowed set.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowedOrigins: Set<string>
): boolean {
  if (!origin || origin === "*") {
    return false;
  }
  return allowedOrigins.has(normalizeOrigin(origin));
}

export interface CorsHeadersOptions {
  origin?: string | null;
  allowedOrigins: Set<string>;
  allowCredentials?: boolean;
  methods?: string[];
  headers?: string[];
  maxAge?: number;
}

/**
 * Builds CORS response headers according to strict security rules:
 * - If origin is allowed, returns exact origin (never '*') and credentials header if requested.
 * - If origin is NOT allowed, withholds Access-Control-Allow-Origin and credentials.
 * - Under NO circumstances will Access-Control-Allow-Origin: '*' coexist with Access-Control-Allow-Credentials: true.
 */
export function buildStrictCorsHeaders({
  origin,
  allowedOrigins,
  allowCredentials = true,
  methods = DEFAULT_ALLOWED_METHODS,
  headers = DEFAULT_ALLOWED_HEADERS,
  maxAge = CORS_MAX_AGE_SECONDS,
}: CorsHeadersOptions): Record<string, string> {
  const result: Record<string, string> = {
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": headers.join(", "),
    "Access-Control-Max-Age": String(maxAge),
  };

  const allowed = isOriginAllowed(origin, allowedOrigins);

  if (allowed && origin) {
    result["Access-Control-Allow-Origin"] = normalizeOrigin(origin);
    result["Vary"] = "Origin";
    if (allowCredentials) {
      result["Access-Control-Allow-Credentials"] = "true";
    }
  }

  return result;
}

/**
 * Handles CORS preflight OPTIONS requests.
 * Rejects preflight requests from disallowed origins with 403 Forbidden.
 * Returns 204 No Content with appropriate CORS headers for allowed origins.
 */
export function handleCorsPreflight(
  request: NextRequest,
  allowedOrigins: Set<string>
): NextResponse | null {
  if (request.method !== "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin");

  // If no origin header is present, treat as generic OPTIONS without CORS headers
  if (!origin) {
    return new NextResponse(null, { status: 204 });
  }

  if (!isOriginAllowed(origin, allowedOrigins)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CORS_PREFLIGHT_FORBIDDEN",
          message: "Preflight request blocked: origin is not permitted.",
        },
      },
      {
        status: 403,
        headers: {
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  }

  const corsHeaders = buildStrictCorsHeaders({
    origin,
    allowedOrigins,
    allowCredentials: true,
  });

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Validates mutation requests (POST, PUT, DELETE, PATCH).
 * If the request has an Origin header that is not in the allowed set, it is rejected.
 */
export function validateMutationOrigin(
  request: NextRequest,
  allowedOrigins: Set<string>
): { allowed: boolean; reason?: string } {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) {
    return { allowed: true };
  }

  const origin = request.headers.get("origin");

  // If an Origin header is sent from a browser, it MUST match the allowlist
  if (origin && !isOriginAllowed(origin, allowedOrigins)) {
    return {
      allowed: false,
      reason: "Cross-origin mutation forbidden by CORS policy.",
    };
  }

  return { allowed: true };
}
