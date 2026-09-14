// SPDX-License-Identifier: MIT

/**
 * Rate limiting for wallet and address lookup endpoints (e.g. GET /api/rbac?addr=G...,
 * GET /api/fee-config/collector, etc.).
 *
 * Lookup endpoints keyed by user-supplied address are cheap to query but can be
 * abused for address enumeration, balance scraping, and RPC hammering.
 *
 * This module enforces:
 *   • per-IP bucket      — throttles broad scanning and automated bursts from a single client
 *   • per-address bucket — throttles targeted hammering of a specific Stellar address
 *
 * Config (env, all optional):
 *   LOOKUP_RATE_LIMIT_IP_RPM   — per-IP lookups per minute (default: 60)
 *   LOOKUP_RATE_LIMIT_ADDR_RPM — per-address lookups per minute (default: 30)
 */

import { getRateLimitStore } from "@/lib/rate-limit";
import { ERROR_CODES } from "@/lib/error-codes";

const WINDOW_MS = 60_000; // 1 minute sliding window

export interface LookupRateLimitConfig {
  /** Window duration in ms (defaults to 60,000ms / 1 min). */
  windowMs?: number;
  /** Max requests per IP per window. */
  ipLimit?: number;
  /** Max requests per Stellar address per window. */
  addressLimit?: number;
}

export interface LookupRateLimitOptions extends LookupRateLimitConfig {
  /** Stellar address being looked up (if supplied). */
  address?: string;
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

/** Build the 429 response with standard RateLimit and Retry-After headers. */
function rateLimitedResponse(
  code: string,
  retryAfterMs: number,
  limit: number,
  resetAt: number
): Response {
  const retryAfterSecs = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    {
      success: false,
      error: {
        code,
        message: "Too many lookup requests. Please try again later.",
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
 * Enforce rate limits on wallet/address lookup endpoints.
 *
 * Returns a 429 Response when the rate limit is exceeded, or null when allowed.
 */
export async function enforceLookupRateLimit(
  request: Request,
  opts: LookupRateLimitOptions = {}
): Promise<Response | null> {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const ipLimit = opts.ipLimit ?? envInt("LOOKUP_RATE_LIMIT_IP_RPM", 60);
  const addressLimit =
    opts.addressLimit ?? envInt("LOOKUP_RATE_LIMIT_ADDR_RPM", 30);

  const store = getRateLimitStore();
  const ip = getClientIp(request);

  // 1. Check per-IP rate limit
  const ipResult = await store.increment(`lookup:ip:${ip}`, windowMs, ipLimit);
  if (!ipResult.allowed) {
    return rateLimitedResponse(
      ERROR_CODES.RATE_LIMIT_IP,
      ipResult.resetAt - Date.now(),
      ipLimit,
      ipResult.resetAt
    );
  }

  // 2. Check per-address rate limit (if target address is specified)
  if (opts.address) {
    const addressResult = await store.increment(
      `lookup:addr:${opts.address}`,
      windowMs,
      addressLimit
    );
    if (!addressResult.allowed) {
      return rateLimitedResponse(
        ERROR_CODES.RATE_LIMIT_WALLET,
        addressResult.resetAt - Date.now(),
        addressLimit,
        addressResult.resetAt
      );
    }
  }

  return null;
}
