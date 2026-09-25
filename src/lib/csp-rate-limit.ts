// SPDX-License-Identifier: MIT

/**
 * Rate limiting for CSP violation reporting collector (POST /api/csp-report).
 *
 * Enforces per-IP sliding window rate limiting to prevent log flooding and DoS.
 *
 * Config (env, optional):
 *   CSP_REPORT_RATE_LIMIT_RPM — per-IP reports per minute (default: 60)
 */

import { getRateLimitStore } from "@/lib/rate-limit";
import { ERROR_CODES } from "@/lib/error-codes";

const WINDOW_MS = 60_000; // 1 minute sliding window

export interface CspRateLimitConfig {
  /** Window duration in ms (defaults to 60,000ms / 1 min). */
  windowMs?: number;
  /** Max reports per IP per window (defaults to 60). */
  ipLimit?: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimitedResponse(
  retryAfterMs: number,
  limit: number,
  resetAt: number
): Response {
  const retryAfterSecs = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    {
      success: false,
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: "Too many CSP reports. Please try again later.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSecs),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

/**
 * Enforce rate limits on CSP reporting endpoint.
 *
 * Returns a 429 Response when the rate limit is exceeded, or null when allowed.
 */
export async function enforceCspRateLimit(
  request: Request,
  opts: CspRateLimitConfig = {}
): Promise<Response | null> {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const ipLimit = opts.ipLimit ?? envInt("CSP_REPORT_RATE_LIMIT_RPM", 60);

  const store = getRateLimitStore();
  const ip = getClientIp(request);

  const ipResult = await store.increment(`csp-report:ip:${ip}`, windowMs, ipLimit);
  if (!ipResult.allowed) {
    return rateLimitedResponse(
      ipResult.resetAt - Date.now(),
      ipLimit,
      ipResult.resetAt
    );
  }

  return null;
}
