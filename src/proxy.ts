// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRateLimitStore } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  RATE_LIMIT_WINDOW_MS,
  getRateLimitMax,
  SKIP_RATE_LIMIT_PATHS,
  resolveClientIp,
  generateRequestId,
  buildCsp,
  SECURITY_HEADERS,
  CORS_CONFIG,
} from "@/lib/security-policy";

// Re-export buildCsp for callers and tests
export { buildCsp };

// Global rate-limit store, resolved once per instance.
//
// This file runs on the Edge runtime, where `ioredis` cannot run. The store
// therefore selects its backend from the *shape* of REDIS_URL: an `https://`
// endpoint (Upstash-compatible REST) is shared across every replica, while a
// `redis://` URL falls back to in-memory here (the Node runtime uses ioredis
// for route-level buckets — see src/lib/rate-limit.ts). With no Redis
// configured the limit is per-instance, exactly as before.
const rateLimitStore = getRateLimitStore();

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = generateRequestId();
  const startedAt = performance.now();
  const rateLimitMax = getRateLimitMax();

  // ── API routes: rate limiting + API headers ─────────────────
  if (pathname.startsWith("/api/")) {
    // Skip rate limiting for health checks and metrics (monitoring endpoints
    // are hit frequently by orchestrators and should never be throttled).
    // The whole `/api/health` subtree is exempt: the readiness probe lives at
    // `/api/health` and the liveness probe at `/api/health/live` (#738), and
    // both must keep answering even when the app is under attack or overloaded.
    const skipRateLimit =
      (SKIP_RATE_LIMIT_PATHS as readonly string[]).includes(pathname) ||
      pathname.startsWith("/api/health/");

    let remaining = rateLimitMax;
    let resetAt = Date.now() + RATE_LIMIT_WINDOW_MS;

    if (!skipRateLimit) {
      const ip = resolveClientIp((h) => request.headers.get(h));
      const result = await rateLimitStore.increment(
        ip,
        RATE_LIMIT_WINDOW_MS,
        rateLimitMax
      );
      remaining = result.remaining;
      resetAt = result.resetAt;

      // Rate limit exceeded
      if (!result.allowed) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        // Rejected before any route handler runs, so log here (with the same
        // request id returned in the response header below).
        logger.request(request.method, pathname, 429, performance.now() - startedAt, requestId);
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests. Please try again later.",
            },
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(retryAfter),
              "X-Request-Id": requestId,
            },
          }
        );
      }
    }

    // Thread the request id into the downstream request headers so route
    // handlers (and their error logs) correlate with the X-Request-Id value
    // returned on the response. NOTE: this must use the `request.headers`
    // option of NextResponse.next() — setting it on the response only is
    // invisible to the route handler.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);

    const response = NextResponse.next({ request: { headers: requestHeaders } });

    // Security, CORS, and observability headers
    response.headers.set("X-Request-Id", requestId);
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(header, value);
    }
    response.headers.set("X-RateLimit-Limit", String(rateLimitMax));
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    // Production CORS — restrict origins in production
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL || CORS_CONFIG.defaultOrigin,
    ].filter(Boolean);
    if (
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV !== "production"
    ) {
      response.headers.set("Access-Control-Allow-Origin", origin || "*");
    }
    response.headers.set(
      "Access-Control-Allow-Methods",
      CORS_CONFIG.allowMethods
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      CORS_CONFIG.allowHeaders
    );

    return response;
  }

  // ── HTML pages: CSP + security headers ──────────────────────
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildCsp());
  response.headers.set("X-Request-Id", requestId);
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value);
  }

  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      // Pages and non-API routes (excluding static assets). Prefetch
      // requests are skipped — they fetch RSC payloads, not HTML.
      source: "/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
