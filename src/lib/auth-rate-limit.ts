// SPDX-License-Identifier: MIT

/**
 * Rate limiting for wallet-auth endpoints (GET /api/auth/challenge and
 * POST /api/auth/session).
 *
 * These endpoints are the wallet-connect attack surface: they are cheap to
 * call and gate the expensive proof-of-ownership flow (challenge minting,
 * signature verification, session issuance). On top of the global per-IP
 * proxy limit they get stricter, targeted buckets:
 *
 *   • per-IP bucket      — throttles address spraying and challenge spam
 *   • per-account bucket — throttles per-wallet churn (challenge minting /
 *                          session attempts) keyed by the Stellar public key
 *
 * Buckets are fully isolated: exhausting one wallet's bucket never blocks a
 * different wallet behind the same IP, and exhausting an IP never blocks a
 * different wallet. Limits are enforced *before* any expensive work runs in
 * the route handler.
 *
 * Config (env, all optional):
 *   AUTH_RATE_LIMIT_IP_RPM     — per-IP requests per minute (default 30)
 *   AUTH_RATE_LIMIT_WALLET_RPM — per-account requests per minute (default 10)
 */

import { getRateLimitStore } from "@/lib/rate-limit";
import { ERROR_CODES } from "@/lib/error-codes";

const WINDOW_MS = 60_000; // 1 minute sliding window

export interface AuthRateLimitConfig {
  /** Window duration in ms (defaults to 60s). */
  windowMs?: number;
  /** Max requests per IP per window. */
  ipLimit?: number;
  /** Max requests per wallet public key per window. */
  walletLimit?: number;
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

/** Build the 429 response with the required Retry-After header. */
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
        message: "Too many requests. Please try again later.",
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

export interface AuthRateLimitOptions extends AuthRateLimitConfig {
  /** Wallet account to charge the per-account bucket against. */
  publicKey?: string;
}

/**
 * Enforce auth rate limits for a wallet-auth request.
 *
 * Returns a 429 Response when a bucket is exhausted, or null when the request
 * is within every limit. Call this at the very top of the route handler —
 * before challenge minting, signature verification, or session issuance —
 * so throttled clients never reach expensive work.
 *
 * @param request   The incoming request (IP is read from proxy headers).
 * @param opts      publicKey — the wallet account to charge the per-account
 *                  bucket against (omit for endpoints with no account context,
 *                  e.g. logout). Limits/window can be overridden per call
 *                  (mainly for tests); otherwise env vars are used.
 */
export async function enforceAuthRateLimit(
  request: Request,
  opts: AuthRateLimitOptions = {}
): Promise<Response | null> {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const ipLimit = opts.ipLimit ?? envInt("AUTH_RATE_LIMIT_IP_RPM", 30);
  const walletLimit =
    opts.walletLimit ?? envInt("AUTH_RATE_LIMIT_WALLET_RPM", 10);

  const store = getRateLimitStore();
  const ip = getClientIp(request);

  // Per-IP bucket first — the cheapest signal and the broadest abuse vector.
  const ipResult = await store.increment(`auth:ip:${ip}`, windowMs, ipLimit);
  if (!ipResult.allowed) {
    return rateLimitedResponse(
      ERROR_CODES.RATE_LIMIT_IP,
      ipResult.resetAt - Date.now(),
      ipLimit,
      ipResult.resetAt
    );
  }

  // Per-account bucket — only when we know which wallet is acting.
  if (opts.publicKey) {
    const walletResult = await store.increment(
      `auth:wallet:${opts.publicKey}`,
      windowMs,
      walletLimit
    );
    if (!walletResult.allowed) {
      return rateLimitedResponse(
        ERROR_CODES.RATE_LIMIT_WALLET,
        walletResult.resetAt - Date.now(),
        walletLimit,
        walletResult.resetAt
      );
    }
  }

  return null;
}
