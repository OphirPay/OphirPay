// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRateLimitStore } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
// Configurable via RATE_LIMIT_RPM env (defaults to 120 requests/min/IP)
const RATE_LIMIT_MAX = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_RPM || "120", 10) || 120
);

// Global rate-limit store, resolved once per instance.
//
// This file runs on the Edge runtime, where `ioredis` cannot run. The store
// therefore selects its backend from the *shape* of REDIS_URL: an `https://`
// endpoint (Upstash-compatible REST) is shared across every replica, while a
// `redis://` URL falls back to in-memory here (the Node runtime uses ioredis
// for route-level buckets — see src/lib/rate-limit.ts). With no Redis
// configured the limit is per-instance, exactly as before.
const rateLimitStore = getRateLimitStore();

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
 * Fresh, unguessable nonce for each HTML request (128 bits, base64).
 */
function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Content-Security-Policy for HTML pages.
 *
 * ### Nonce-based script-src (issue #1257, follow-up to #697)
 *
 * Next.js App Router injects inline scripts we do not author (the RSC /
 * streaming bootstrap and the flight payload). Instead of `'unsafe-inline'`,
 * each HTML request gets a fresh nonce:
 *
 *   1. The proxy generates the nonce and sets the full CSP on the *request*
 *      headers passed to `NextResponse.next({ request: { headers } })`. The
 *      App Router renderer reads `content-security-policy` from the incoming
 *      request (next/dist/server/app-render/app-render.js,
 *      `getScriptNonceFromHeader`) and stamps `nonce="…"` on every framework
 *      `<script>` it emits. Setting the header only on the *response* — which
 *      is what this file did before — never reaches the renderer; that was
 *      the real cause of the "nonce does not propagate" behaviour recorded in
 *      #697 / next.js issue #74803.
 *   2. The same nonce is forwarded as `x-nonce` so `src/app/layout.tsx` can
 *      put it on our own inline scripts (theme bootstrap, SW registration).
 *   3. The same CSP string is set on the response so the browser enforces it.
 *
 * `'strict-dynamic'` lets nonce-trusted scripts load their chunks; `'self'`
 * stays as a fallback for browsers without CSP3 support (ignored by those that
 * support `'strict-dynamic'`).
 *
 * Re-tested against next@16.3.4 on 2026-09-30.
 *
 * Development additionally needs 'unsafe-eval' for HMR / Fast Refresh.
 *
 * ### CSP violation reporting (issue #698)
 *
 * `report-to` points at the OphirPay-side collector (POST /api/csp-report).
 * The collector validates and size-limits the body, logs a redacted structured
 * line via logger.ts, and increments the csp_violation_reports_total metric.
 * `report-uri` is the legacy fallback for browsers that do not support the
 * Reporting API header yet (Safari < 17, Firefox without the flag).
 */
function buildCsp(nonce: string): string {
  const scriptSrc = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'`;

  // The Reporting API group name must match the Report-To / Reporting-Endpoints
  // header value set just below in the HTML-page response branch.
  const reportingGroup = "csp-endpoint";
  const reportUri = "/api/csp-report";

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
    // Reporting API (RFC 7469 successor) — supported by Chrome 70+, Edge 79+.
    `report-to ${reportingGroup}`,
    // Legacy fallback for Safari, older Firefox, and any browser that does not
    // implement the Reporting API yet.  The collector accepts both formats.
    `report-uri ${reportUri}`,
  ].join("; ");
}

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
      const ip = getClientIp(request);
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
  // The CSP must be on the *request* headers for the App Router renderer to
  // pick up the nonce (see buildCsp above), and on the response for the
  // browser to enforce it.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Api-Version", "1.0.0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Reporting API (issue #698) — tells the browser where to POST violation
  // reports.  `Report-To` is the older format (Chrome 70+ / Edge 79+);
  // `Reporting-Endpoints` is the newer NEL-aligned format (Chrome 96+).
  // We set both so all Chromium-based browsers are covered.
  const cspReportEndpoint = "/api/csp-report";
  const reportToValue = JSON.stringify({
    group: "csp-endpoint",
    max_age: 10886400, // 126 days
    endpoints: [{ url: cspReportEndpoint }],
    include_subdomains: false,
  });
  response.headers.set("Report-To", reportToValue);
  // The modern Reporting-Endpoints header (a simple name=url pair).
  response.headers.set(
    "Reporting-Endpoints",
    `csp-endpoint="${cspReportEndpoint}"`
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
