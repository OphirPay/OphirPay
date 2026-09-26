// SPDX-License-Identifier: MIT
//
// Rate limiting for wallet and address lookup endpoints (e.g. GET /api/rbac?addr=G...,
// GET /api/fee-config/collector, etc.).
//
// Lookup endpoints keyed by user-supplied address are cheap to query but can be
// abused for address enumeration, balance scraping, and RPC hammering.
//
// This module enforces:
//   • per-IP bucket      — throttles broad scanning and automated bursts from a single client
//   • per-address bucket — throttles targeted hammering of a specific Stellar address
//
// Window semantics, bucket keys, header formatting and enforcement live in
// `src/lib/rate-limit.ts` (issue #759); this module only supplies the
// endpoint's policy data. Config (env, all optional):
//   LOOKUP_RATE_LIMIT_IP_RPM   — per-IP lookups per minute (default: 60)
//   LOOKUP_RATE_LIMIT_ADDR_RPM — per-address lookups per minute (default: 30)

import {
  LOOKUP_RATE_LIMIT_POLICY,
  enforceRateLimit,
  type EnforceRateLimitOptions,
} from "@/lib/rate-limit";

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

/**
 * Enforce rate limits on wallet/address lookup endpoints.
 *
 * Returns a 429 Response when the rate limit is exceeded, or null when allowed.
 */
export async function enforceLookupRateLimit(
  request: Request,
  opts: LookupRateLimitOptions = {}
): Promise<Response | null> {
  const shared: EnforceRateLimitOptions = {
    target: opts.address,
    windowMs: opts.windowMs,
    ipLimit: opts.ipLimit,
    targetLimit: opts.addressLimit,
  };
  return enforceRateLimit(request, LOOKUP_RATE_LIMIT_POLICY, shared);
}
