// SPDX-License-Identifier: MIT

import { getRateLimitStore } from "./rate-limit";
import { getRateLimitHeaders } from "./rate-limit-headers";

export interface WalletAuthRateLimitConfig {
  ipMaxRequests?: number;
  ipWindowMs?: number;
  accountMaxRequests?: number;
  accountWindowMs?: number;
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}

/**
 * Check rate limits for wallet-auth and session endpoints.
 * Enforces two isolated sliding-window buckets:
 * 1. Per-IP bucket: prevents high-frequency IP-based spraying.
 * 2. Per-Account bucket: prevents brute-force targeting of specific public keys.
 */
export async function checkWalletAuthRateLimit(
  request: Request,
  publicKey?: string,
  config?: WalletAuthRateLimitConfig
): Promise<Response | null> {
  const store = getRateLimitStore();

  const ipLimit = config?.ipMaxRequests ?? parseInt(process.env.RATE_LIMIT_AUTH_IP_MAX ?? "20", 10);
  const ipWindow = config?.ipWindowMs ?? parseInt(process.env.RATE_LIMIT_AUTH_IP_WINDOW_MS ?? "60000", 10);

  const accountLimit = config?.accountMaxRequests ?? parseInt(process.env.RATE_LIMIT_AUTH_ACCOUNT_MAX ?? "10", 10);
  const accountWindow = config?.accountWindowMs ?? parseInt(process.env.RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MS ?? "60000", 10);

  const ip = getClientIp(request);

  // 1. IP Bucket check
  const ipResult = await store.increment(`auth:ip:${ip}`, ipWindow, ipLimit);
  if (!ipResult.allowed) {
    const resetSec = Math.ceil(ipResult.resetAt / 1000);
    const headers = getRateLimitHeaders({
      limit: ipLimit,
      remaining: 0,
      reset: resetSec,
    });
    return new Response(
      JSON.stringify({
        success: false,
        error: "Too many authentication requests from this IP. Please try again later.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      }
    );
  }

  // 2. Account Bucket check (if public key is provided)
  if (publicKey) {
    const accountResult = await store.increment(`auth:account:${publicKey}`, accountWindow, accountLimit);
    if (!accountResult.allowed) {
      const resetSec = Math.ceil(accountResult.resetAt / 1000);
      const headers = getRateLimitHeaders({
        limit: accountLimit,
        remaining: 0,
        reset: resetSec,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: `Too many authentication attempts for account ${publicKey}. Please try again later.`,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
        }
      );
    }
  }

  return null;
}
