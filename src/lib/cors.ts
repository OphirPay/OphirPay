// SPDX-License-Identifier: MIT
// Issue #1393 — Strict CORS origin allowlist validator.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Standard allowed methods on public API routes. */
export const CORS_ALLOWED_METHODS = "GET, POST, PUT, DELETE, PATCH, OPTIONS";

/** Standard allowed headers for authenticated API requests. */
export const CORS_ALLOWED_HEADERS =
  "Content-Type, Authorization, X-API-Key, X-Request-Id, X-CSRF-Token";

/** Preflight cache duration (24 hours). */
export const CORS_MAX_AGE_SECONDS = "86400";

/** Normalize an origin string: lowercase scheme + host, strip trailing slash. */
export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (trimmed === "*") return "*";
  try {
    const parsed = new URL(trimmed);
    return parsed.origin.toLowerCase();
  } catch {
    // If it cannot be parsed as a URL, strip trailing slashes and lowercase
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Parse and resolve the set of allowed domain origins from the environment.
 * Reads `ALLOWED_ORIGINS` (comma-, semicolon-, or whitespace-separated)
 * and `NEXT_PUBLIC_APP_URL`.
 *
 * In non-production environments without an explicit `ALLOWED_ORIGINS`,
 * local development origins (`http://localhost:3000`, `http://127.0.0.1:3000`)
 * are permitted by default.
 */
export function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>();

  const rawEnv = process.env.ALLOWED_ORIGINS;
  if (rawEnv && rawEnv.trim() !== "") {
    const tokens = rawEnv.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    for (const token of tokens) {
      allowed.add(normalizeOrigin(token));
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && appUrl.trim() !== "") {
    allowed.add(normalizeOrigin(appUrl));
  }

  // Local development fallbacks if no explicit origins are set
  if (allowed.size === 0 && process.env.NODE_ENV !== "production") {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
    allowed.add("http://localhost:3001");
  }

  return allowed;
}

/**
 * Determine whether a given request origin is permitted by the allowlist.
 */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin || origin.trim() === "") return false;
  const normalized = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();
  return allowed.has(normalized);
}

export interface CorsResolution {
  allowed: boolean;
  originHeader: string | null;
  allowCredentials: boolean;
}

/**
 * Resolve CORS origin and credential safety:
 * - When allowed: returns the matching origin header.
 * - Wildcard `*` is strictly blocked whenever credentials are included.
 */
export function resolveCorsOrigin(
  origin: string | null | undefined,
  allowCredentials = true
): CorsResolution {
  if (!origin || origin.trim() === "") {
    return { allowed: false, originHeader: null, allowCredentials: false };
  }

  const normalized = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();

  if (allowed.has(normalized)) {
    return {
      allowed: true,
      originHeader: normalized,
      allowCredentials,
    };
  }

  // If wildcard is configured in allowed origins
  if (allowed.has("*")) {
    if (allowCredentials) {
      // SECURITY REQUIREMENT (#1393): Wildcard origin is NEVER returned
      // alongside Access-Control-Allow-Credentials: true.
      return { allowed: false, originHeader: null, allowCredentials: false };
    }
    return { allowed: true, originHeader: "*", allowCredentials: false };
  }

  return { allowed: false, originHeader: null, allowCredentials: false };
}

/**
 * Handle CORS preflight `OPTIONS` requests:
 * Rejects preflight requests with 403 Forbidden if the origin does not match the allowlist.
 */
export function handleCorsPreflight(
  request: Request | NextRequest,
  options?: { allowCredentials?: boolean }
): NextResponse {
  const origin = request.headers.get("origin");
  const allowCredentials = options?.allowCredentials ?? true;

  if (!origin) {
    return new NextResponse(null, { status: 204 });
  }

  const resolution = resolveCorsOrigin(origin, allowCredentials);
  if (!resolution.allowed || !resolution.originHeader) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "CORS preflight origin not allowed",
        },
      },
      { status: 403 }
    );
  }

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", resolution.originHeader);
  headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  headers.set("Access-Control-Max-Age", CORS_MAX_AGE_SECONDS);
  headers.set("Vary", "Origin");

  if (resolution.allowCredentials && resolution.originHeader !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return new NextResponse(null, { status: 204, headers });
}

/**
 * Apply strict CORS headers to an outgoing NextResponse.
 * If origin is provided but disallowed on mutation methods (POST, PUT, DELETE, PATCH),
 * returns a 403 Forbidden response.
 */
export function applyCorsHeaders(
  response: NextResponse,
  request: Request | NextRequest,
  options?: { allowCredentials?: boolean }
): NextResponse {
  const origin = request.headers.get("origin");
  if (!origin) return response;

  const method = request.method.toUpperCase();
  const allowCredentials = options?.allowCredentials ?? true;
  const resolution = resolveCorsOrigin(origin, allowCredentials);

  if (!resolution.allowed || !resolution.originHeader) {
    // For mutation endpoints, reject disallowed cross-origin requests
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "Cross-origin request blocked: origin not allowed",
          },
        },
        { status: 403 }
      );
    }
    // For safe methods (GET/HEAD), do not set CORS allow headers (browser will block)
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", resolution.originHeader);
  response.headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  response.headers.set("Vary", "Origin");

  if (resolution.allowCredentials && resolution.originHeader !== "*") {
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}
