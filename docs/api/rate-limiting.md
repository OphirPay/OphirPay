# API Rate Limiting & Tier Quotas Guide

OphirPay employs a multi-tiered rate limiting architecture designed to protect payment orchestration services, smart contract indexers, and authentication endpoints against abuse, denial-of-service (DoS), address scanning, and credential/challenge brute-forcing.

---

## Table of Contents

- [Overview](#overview)
- [Rate Limit HTTP Headers](#rate-limit-http-headers)
- [Tier Quotas Reference](#tier-quotas-reference)
  - [1. Global Proxy Tier](#1-global-proxy-tier)
  - [2. Wallet Authentication Tier](#2-wallet-authentication-tier)
  - [3. Address & Wallet Lookup Tier](#3-address--wallet-lookup-tier)
  - [4. API Key Lifecycle Tier](#4-api-key-lifecycle-tier)
- [HTTP 429 Error Response Format](#http-429-error-response-format)
- [Client Integration & Backoff Implementation](#client-integration--backoff-implementation)
- [Distributed Rate Limiting with Redis](#distributed-rate-limiting-with-redis)

---

## Overview

Rate limiting in OphirPay is enforced across two distinct layers:
1. **Edge Proxy Layer (`src/proxy.ts`)**: Evaluates incoming traffic at the Edge network before route handlers are invoked, mitigating volumetric spikes and abusive IPs with minimal CPU overhead.
2. **Route Handler Layer**: Enforces fine-grained, contextual rate limiting based on authenticated session identity, Stellar public key, and queried destination addresses.

Every request that consumes quota receives standardized rate-limiting headers in the HTTP response.

---

## Rate Limit HTTP Headers

OphirPay follows standard `X-RateLimit-*` conventions and RFC 6585 `Retry-After` specifications.

### Headers Sent on Every API Response

| Header Name | Type | Description |
|---|---|---|
| `X-RateLimit-Limit` | Integer | The maximum number of requests allowed within the current evaluation window. |
| `X-RateLimit-Remaining` | Integer | The remaining number of requests allowed within the current window (floored at `0`). |
| `X-RateLimit-Reset` | Integer | Unix epoch timestamp in **seconds** when the current rate limit window resets. |
| `X-Request-Id` | String | Unique UUID assigned to the request, useful for correlating server-side logs with client errors. |

### Additional Header Sent on Throttled Responses (HTTP 429)

| Header Name | Type | Description |
|---|---|---|
| `Retry-After` | Integer | The number of **seconds** the client must wait before retrying the request. |

> [!NOTE]
> `Retry-After` is only attached when a client has exceeded its rate limit quota (`HTTP 429 Too Many Requests`). Clients should read this header directly to determine their backoff duration.

---

## Tier Quotas Reference

OphirPay separates endpoints into four distinct tiers with independent rate limit buckets:

| Tier | Target Endpoints | Keyed By | Default Limit | Environment Variable Override |
|---|---|---|---|---|
| **Global Proxy Tier** | `/api/*` (except health/metrics) | Client IP | 120 req / 60s | `RATE_LIMIT_RPM` |
| **Wallet Auth (IP)** | `/api/auth/challenge`, `/api/auth/session` | Client IP | 30 req / 60s | `AUTH_RATE_LIMIT_IP_RPM` |
| **Wallet Auth (Account)** | `/api/auth/challenge`, `/api/auth/session` | Stellar Public Key | 10 req / 60s | `AUTH_RATE_LIMIT_WALLET_RPM` |
| **Address Lookup (IP)** | `/api/rbac`, `/api/fee-config/*`, address query routes | Client IP | 60 req / 60s | `LOOKUP_RATE_LIMIT_IP_RPM` |
| **Address Lookup (Target)** | `/api/rbac`, `/api/fee-config/*`, address query routes | Stellar Address | 30 req / 60s | `LOOKUP_RATE_LIMIT_ADDR_RPM` |
| **API Key Mutations** | `POST /api/keys`, `POST /api/keys/rotate` | User ID | 5 ops / 1 hour | `MAX_API_KEY_MUTATIONS_PER_HOUR` |
| **Active Key Capacity** | `POST /api/keys` | User ID | Max 5 active keys | `MAX_ACTIVE_API_KEYS` |

---

### 1. Global Proxy Tier

The global proxy limiter guards all `/api/*` routes against abusive request floods:
- **Default Limit**: 120 requests per minute per IP address.
- **Sliding Window**: 60 seconds (`RATE_LIMIT_WINDOW_MS = 60000`).
- **Exempt Endpoints**:
  - `/api/health` and `/api/health/*` (liveness and readiness probes must remain responsive under high load or cluster health checks).
  - `/api/metrics` (Prometheus metrics scraper, authenticated via `METRICS_TOKEN`).

---

### 2. Wallet Authentication Tier

Wallet authentication routes (`GET /api/auth/challenge` and `POST /api/auth/session`) handle cryptographic challenge minting, cryptographic signature verification, and session token generation.

To prevent address spraying and per-wallet resource exhaustion, requests are throttled across two isolated buckets:
- **Per-IP Bucket (`AUTH_RATE_LIMIT_IP_RPM = 30`)**: Limits challenge requests from an individual IP address to 30 requests per minute.
- **Per-Account Bucket (`AUTH_RATE_LIMIT_WALLET_RPM = 10`)**: Limits challenge creation and session attempts for a specific Stellar public key (`G...`) to 10 requests per minute, regardless of how many distinct IP addresses initiate the request.

---

### 3. Address & Wallet Lookup Tier

Lookup endpoints (`/api/rbac`, `/api/fee-config/collector`) resolve on-chain contract permissions and account roles:
- **Per-IP Bucket (`LOOKUP_RATE_LIMIT_IP_RPM = 60`)**: Prevents automated clients from scanning address lists or enumerating active accounts.
- **Per-Address Bucket (`LOOKUP_RATE_LIMIT_ADDR_RPM = 30`)**: Protects individual merchant or signer addresses from targeted RPC hammering.

---

### 4. API Key Lifecycle Tier

API key generation and rotation endpoints protect database transaction serialization and prevent credential sprawl:
- **Hourly Mutation Quota**: Limited to 5 operations per user per hour (`consumeApiKeyMutationQuota`). Exceeding this limit returns `HTTP 429` with `error.code: "RATE_LIMITED"`.
- **Active Key Cap**: Accounts are limited to a maximum of 5 simultaneously active API keys. Attempting to generate a sixth active key returns `HTTP 409 Conflict` (`error.code: "CONFLICT"`), instructing the user to revoke or rotate an existing key.

---

## HTTP 429 Error Response Format

When any rate limit quota is exceeded, OphirPay returns an HTTP `429 Too Many Requests` response formatted according to the standard API response schema:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json; charset=utf-8
X-Request-Id: 9b2d6a5c-43f1-4df6-82bb-7629b3986a11
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1718000060
Retry-After: 35
```

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  }
}
```

For API key mutation throttling, the response body includes additional timestamp context:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "API key operation limit reached (5 per hour). Try again after 2026-11-18T18:00:00.000Z.",
    "details": {
      "limit": 5,
      "remaining": 0,
      "resetAt": "2026-11-18T18:00:00.000Z"
    }
  }
}
```

---

## Client Integration & Backoff Implementation

When building clients or backend integrations with OphirPay, implement automatic retry logic using **Exponential Backoff with Full Jitter** and prioritize the `Retry-After` header when present.

### Production-Ready TypeScript Example

```typescript
// SPDX-License-Identifier: MIT

interface RequestOptions extends RequestInit {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Executes an HTTP fetch request against OphirPay with automatic rate-limit
 * handling, reading Retry-After and applying exponential backoff with jitter.
 */
export async function fetchWithRateLimitRetry(
  url: string,
  options: RequestOptions = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;

  let attempt = 0;

  while (true) {
    const response = await fetch(url, options);

    // If request succeeded or error is not rate-limiting, return immediately
    if (response.status !== 429 || attempt >= maxRetries) {
      return response;
    }

    attempt++;

    // 1. Check if server specified exact wait time via Retry-After header
    const retryAfterHeader = response.headers.get("Retry-After");
    let waitMs: number;

    if (retryAfterHeader) {
      const seconds = parseInt(retryAfterHeader, 10);
      waitMs = Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : initialDelayMs;
    } else {
      // 2. Fall back to exponential backoff with full jitter
      const expDelay = initialDelayMs * Math.pow(2, attempt - 1);
      const cappedDelay = Math.min(expDelay, maxDelayMs);
      waitMs = Math.floor(Math.random() * cappedDelay);
    }

    const requestId = response.headers.get("X-Request-Id") ?? "unknown";
    console.warn(
      `[OphirPay Client] Rate limit exceeded (attempt ${attempt}/${maxRetries}). ` +
      `Request ID: ${requestId}. Retrying in ${waitMs}ms...`
    );

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

// Example usage:
// const res = await fetchWithRateLimitRetry("https://api.ophirpay.com/api/payments", {
//   headers: { "Authorization": "Bearer ophir_live_..." }
// });
// const data = await res.json();
```

---

## Distributed Rate Limiting with Redis

In multi-instance and Kubernetes deployments, configure Redis to share rate limit counters across all running pods:

- **Upstash REST Endpoint (`https://...`)**: Works across both Edge runtime (`src/proxy.ts`) and Node.js route handlers.
- **Direct Redis Protocol (`redis://...`)**: Used by Node.js runtime for targeted route-level rate limiting.
- **Memory Store Fallback**: If `REDIS_URL` is omitted, OphirPay falls back to an in-memory sliding window store scoped to each individual pod or instance.
