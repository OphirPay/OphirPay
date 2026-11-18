// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRateLimitStore } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  buildCsp,
  CSP_POLICY,
  generateNonce,
  generateRequestId,
  getClientIp,
  getRateLimitMax,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/proxy-config";

import {
  handleCorsPreflight,
  resolveCorsOrigin,
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_HEADERS,
} from "@/lib/cors";
import {
  extractApiKey,
  validateKeyFormat,
  API_KEY_LOOKUP_PATTERN,
} from "@/lib/api-key-format";
import { hasSessionCookie, verifyCsrfForRequest } from "@/lib/csrf-token";
import { applySecurityHeaders } from "@/lib/security-headers";
import {
  getRateLimitHeaders,
  getRateLimitExceededHeaders,
  rateLimitInfoFromResult,
  getRetryAfterHeaderValue,
} from "@/lib/rate-limit-headers";

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
  // Extract existing X-Request-ID if provided, or generate a new one (issue #1951)
  const incomingRequestId = request.headers.get("x-request-id");
  const requestId =
    incomingRequestId && incomingRequestId.trim().length > 0
      ? incomingRequestId.trim()
      : generateRequestId();
  const startedAt = performance.now();

  // ── API routes: rate limiting + CORS + API key edge validation ─
  if (pathname.startsWith("/api/")) {
    // 1. Strict CORS preflight handling (#1393)
    if (request.method === "OPTIONS") {
      const preflight = handleCorsPreflight(request, { allowCredentials: true });
      // Every API response — including preflight — carries the correlation id
      // so browser-side CORS failures can be traced to a server log line.
      preflight.headers.set("X-Request-Id", requestId);
      return preflight;
    }

    // 1b. CSRF defense-in-depth for cookie-authenticated browser sessions.
    //
    // Route handlers already call verifyCsrf(), but a single central check
    // closes the gap for any future mutating route that forgets to. It applies
    // only when a session cookie is present: login has no session yet, and
    // API-key/cron callers bypass the double-submit check in
    // verifyCsrfForRequest(). Reads and preflights are untouched.
    if (
      hasSessionCookie(request.headers.get("cookie")) &&
      !verifyCsrfForRequest(request)
    ) {
      logger.request(
        request.method,
        pathname,
        403,
        performance.now() - startedAt,
        requestId
      );
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CSRF_INVALID",
            message:
              "Invalid or missing CSRF token. Refresh the page and try again.",
          },
        },
        {
          status: 403,
          headers: {
            "X-Request-Id": requestId,
            "Cache-Control": "no-store",
          },
        }
      );
    }

    // 2. Edge API key validation (#1397): reject malformed keys before DB lookup
    const rawApiKey = extractApiKey(request);
    if (rawApiKey && pathname !== "/api/metrics") {
      const keyValidation = validateKeyFormat(rawApiKey);
      const isLegacy = API_KEY_LOOKUP_PATTERN.test(rawApiKey);
      if (!keyValidation.valid && !isLegacy) {
        const unauthorized = NextResponse.json(
          {
            success: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid API key format",
            },
          },
          { status: 401 }
        );
        unauthorized.headers.set("X-Request-Id", requestId);
        applySecurityHeaders(unauthorized.headers);
        return unauthorized;
      }
    }

    // Skip rate limiting for health checks and metrics (monitoring endpoints
    // are hit frequently by orchestrators and should never be throttled).
    // The whole `/api/health` subtree is exempt: the readiness probe lives at
    // `/api/health` and the liveness probe at `/api/health/live` (#738), and
    // both must keep answering even when the app is under attack or overloaded.
    const skipRateLimit =
      pathname === "/api/health" ||
      pathname.startsWith("/api/health/") ||
      pathname === "/api/metrics";

    // Defaults for exempt endpoints (health/metrics), which still advertise
    // the window even though they are never throttled.
    let rateLimitHeaders = getRateLimitHeaders({
      limit: RATE_LIMIT_MAX,
      remaining: RATE_LIMIT_MAX,
      reset: Math.ceil((Date.now() + RATE_LIMIT_WINDOW_MS) / 1000),
    });

    if (!skipRateLimit) {
      const ip = getClientIp(request.headers);
      const result = await rateLimitStore.increment(
        ip,
        RATE_LIMIT_WINDOW_MS,
        RATE_LIMIT_MAX
      );
      const info = rateLimitInfoFromResult(result);
      rateLimitHeaders = result.allowed
        ? getRateLimitHeaders(info)
        : getRateLimitExceededHeaders(info);

      // Rate limit exceeded
      if (!result.allowed) {
        // Rejected before any route handler runs, so log here (with the same
        // request id returned in the response header below).
        logger.request(request.method, pathname, 429, performance.now() - startedAt, requestId);
        const rateLimited = NextResponse.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests. Please try again later.",
            },
          },
          {
            status: 429,
            // Limit / Remaining / Reset / Retry-After — a 429 without these
            // forces SDKs to guess the backoff window.
            headers: {
              ...rateLimitHeaders,
              "X-Request-Id": requestId,
            },
          }
        );
        const retryAfter = getRetryAfterHeaderValue(info);
        rateLimited.headers.set("Retry-After", String(retryAfter));
        rateLimited.headers.set("X-Request-Id", requestId);
        applySecurityHeaders(rateLimited.headers);
        return rateLimited;
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
    applySecurityHeaders(response.headers);
    for (const [name, value] of Object.entries(rateLimitHeaders)) {
      response.headers.set(name, value);
    }

    // Strict CORS resolution (#1393)
    const origin = request.headers.get("origin");
    if (origin) {
      const resolution = resolveCorsOrigin(origin, true);
      const method = request.method.toUpperCase();

      // For mutation endpoints, reject disallowed cross-origin requests
      if (!resolution.allowed && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
        const forbidden = NextResponse.json(
          {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Cross-origin request blocked: origin not allowed",
            },
          },
          { status: 403 }
        );
        forbidden.headers.set("X-Request-Id", requestId);
        applySecurityHeaders(forbidden.headers);
        return forbidden;
      }

      if (resolution.allowed && resolution.originHeader) {
        response.headers.set("Access-Control-Allow-Origin", resolution.originHeader);
        response.headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
        response.headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
        response.headers.set("Vary", "Origin");
        if (resolution.allowCredentials && resolution.originHeader !== "*") {
          response.headers.set("Access-Control-Allow-Credentials", "true");
        }
      }
    }

    return response;
  }

  // ── HTML pages: CSP + security headers ──────────────────────
  // The CSP has to reach the App Router renderer on the *request* headers, not
  // just the response: `getScriptNonceFromHeader` reads
  // `content-security-policy` from the incoming request and stamps `nonce="…"`
  // on every framework `<script>` it emits. Setting it on the response alone
  // was the real cause of the "nonce does not propagate" behaviour in #697.
  // `x-nonce` carries the same value to src/app/layout.tsx for our own inline
  // scripts (theme bootstrap, service-worker registration).
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const pageRequestHeaders = new Headers(request.headers);
  pageRequestHeaders.set("x-nonce", nonce);
  pageRequestHeaders.set("Content-Security-Policy", csp);
  pageRequestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: pageRequestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Api-Version", "1.0.0");
  applySecurityHeaders(response.headers);

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

export default proxy;
