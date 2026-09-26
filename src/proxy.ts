// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getRateLimitStore,
  buildBucketKey,
  writeRateLimitHeaders,
  RATE_LIMIT_POLICIES,
  type RateLimitInfo,
} from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
const isProd = process.env.NODE_ENV === "production";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Content-Security-Policy for HTML pages.
 *
 * Next.js (App Router) injects inline streaming/hydration scripts, and this
 * Next 16 build does not propagate a per-request nonce (via x-nonce or a
 * request-header CSP) to the app renderer, so a script-src without
 * 'unsafe-inline' blocks them and the app never hydrates. We therefore keep
 * 'unsafe-inline' in script-src while every other directive stays strict
 * (default-src 'self', connect-src whitelisted to Stellar endpoints only,
 * frame-src limited to wallet extensions, object-src 'none', ...).
 * Development additionally needs 'unsafe-eval' for HMR / Fast Refresh.
 */
function buildCsp(): string {
  const scriptSrc = isProd
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval'"
    : "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // Horizon + Soroban RPC + Stellar Expert
    "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so",
    "img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com",
    "font-src 'self'",
    "frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = generateRequestId();
  const startedAt = performance.now();

  // ── API routes: rate limiting + API headers ─────────────────
  if (pathname.startsWith("/api/")) {
    // Skip rate limiting for health checks and metrics (monitoring endpoints
    // are hit frequently by orchestrators and should never be throttled)
    const skipRateLimit =
      pathname === "/api/health" || pathname === "/api/metrics";

    const policy = RATE_LIMIT_POLICIES.PROXY;
    const windowMs = policy.windowMs;
    const ipLimit = Math.max(
      1,
      parseInt(process.env.RATE_LIMIT_RPM || String(policy.ipLimit), 10) || policy.ipLimit
    );
    const store = getRateLimitStore();

    let remaining = ipLimit;
    let resetAt = Date.now() + windowMs;

    if (!skipRateLimit) {
      const ip = getClientIp(request);
      const key = buildBucketKey(policy.name, "ip", ip);
      const result = await store.increment(
        key,
        windowMs,
        ipLimit
      );
      remaining = result.remaining;
      resetAt = result.resetAt;

      // Rate limit exceeded
      if (!result.allowed) {
        // Rejected before any route handler runs, so log here (with the same
        // request id returned in the response header below).
        logger.request(request.method, pathname, 429, performance.now() - startedAt, requestId);
        const info: RateLimitInfo = {
          limit: ipLimit,
          remaining: 0,
          reset: Math.ceil(resetAt / 1000),
        };
        const headers = writeRateLimitHeaders(info, {
          "X-Request-Id": requestId,
        });
        return NextResponse.json(
          {
            success: false,
            error: {
              code: policy.ipErrorCode,
              message: policy.errorMessage,
            },
          },
          {
            status: 429,
            headers,
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

    const info: RateLimitInfo = {
      limit: ipLimit,
      remaining,
      reset: Math.ceil(resetAt / 1000),
    };
    const rlHeaders = writeRateLimitHeaders(info);
    response.headers.set("X-RateLimit-Limit", rlHeaders["X-RateLimit-Limit"]);
    response.headers.set("X-RateLimit-Remaining", rlHeaders["X-RateLimit-Remaining"]);
    response.headers.set("X-RateLimit-Reset", rlHeaders["X-RateLimit-Reset"]);

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
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildCsp());
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Api-Version", "1.0.0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

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
