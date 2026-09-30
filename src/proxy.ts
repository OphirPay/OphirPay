// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRateLimitStore } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  buildCsp,
  CSP_POLICY,
  generateRequestId,
  getClientIp,
  getRateLimitMax,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/proxy-config";

const RATE_LIMIT_MAX = getRateLimitMax();

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

  // ── API routes: rate limiting + API headers ─────────────────
  if (pathname.startsWith("/api/")) {
    // Skip rate limiting for health checks and metrics (monitoring endpoints
    // are hit frequently by orchestrators and should never be throttled).
    // The whole `/api/health` subtree is exempt: the readiness probe lives at
    // `/api/health` and the liveness probe at `/api/health/live` (#738), and
    // both must keep answering even when the app is under attack or overloaded.
    const skipRateLimit =
      pathname === "/api/health" ||
      pathname.startsWith("/api/health/") ||
      pathname === "/api/metrics";

    let remaining = RATE_LIMIT_MAX;
    let resetAt = Date.now() + RATE_LIMIT_WINDOW_MS;

    if (!skipRateLimit) {
      const ip = getClientIp(request.headers);
      const result = await rateLimitStore.increment(
        ip,
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX
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
    response.headers.set("X-Api-Version", "1.0.0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    // Production CORS — restrict origins in production
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    ].filter(Boolean);
    if (
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV !== "production"
    ) {
      response.headers.set("Access-Control-Allow-Origin", origin || "*");
    }
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-API-Key"
    );

    return response;
  }

  // ── HTML pages: CSP + security headers ──────────────────────
  // `src/proxy.ts` keeps `'unsafe-inline'` because the App Router still emits
  // hydration scripts that do not receive proxy nonces reliably.
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildCsp());
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Api-Version", "1.0.0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Reporting API (issue #698) — tells the browser where to POST violation
  // reports.  `Report-To` is the older format (Chrome 70+ / Edge 79+);
  // `Reporting-Endpoints` is the newer NEL-aligned format (Chrome 96+).
  // We set both so all Chromium-based browsers are covered.
  const cspReportEndpoint = CSP_POLICY.reportUri;
  const reportToValue = JSON.stringify({
    group: CSP_POLICY.reportingGroup,
    max_age: 10886400, // 126 days
    endpoints: [{ url: cspReportEndpoint }],
    include_subdomains: false,
  });
  response.headers.set("Report-To", reportToValue);
  // The modern Reporting-Endpoints header (a simple name=url pair).
  response.headers.set(
    "Reporting-Endpoints",
    `${CSP_POLICY.reportingGroup}="${cspReportEndpoint}"`
  );

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
