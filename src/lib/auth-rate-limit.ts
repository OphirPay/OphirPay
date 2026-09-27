// SPDX-License-Identifier: MIT
//
// Rate limiting for wallet-auth endpoints (GET /api/auth/challenge and
// POST /api/auth/session).
//
// These endpoints are the wallet-connect attack surface: they are cheap to
// call and gate the expensive proof-of-ownership flow (challenge minting,
// signature verification, session issuance). On top of the global per-IP
// proxy limit they get stricter, targeted buckets:
//
//   • per-IP bucket      — throttles address spraying and challenge spam
//   • per-account bucket — throttles per-wallet churn (challenge minting /
//                          session attempts) keyed by the Stellar public key
//
// Buckets are fully isolated: exhausting one wallet's bucket never blocks a
// different wallet behind the same IP, and exhausting an IP never blocks a
// different wallet. Limits are enforced *before* any expensive work runs in
// the route handler.
//
// The window, bucket keys, header formatting and enforcement all live in
// `src/lib/rate-limit.ts` (issue #759); this module only supplies the
// endpoint's policy data. Config (env, all optional):
//   AUTH_RATE_LIMIT_IP_RPM     — per-IP requests per minute (default 30)
//   AUTH_RATE_LIMIT_WALLET_RPM — per-account requests per minute (default 10)

import {
  AUTH_RATE_LIMIT_POLICY,
  enforceRateLimit,
  type EnforceRateLimitOptions,
} from "@/lib/rate-limit";

export interface AuthRateLimitConfig {
  /** Window duration in ms (defaults to 60s). */
  windowMs?: number;
  /** Max requests per IP per window. */
  ipLimit?: number;
  /** Max requests per wallet public key per window. */
  walletLimit?: number;
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
  const shared: EnforceRateLimitOptions = {
    target: opts.publicKey,
    windowMs: opts.windowMs,
    ipLimit: opts.ipLimit,
    targetLimit: opts.walletLimit,
  };
  return enforceRateLimit(request, AUTH_RATE_LIMIT_POLICY, shared);
}
