# Cross-Origin Resource Sharing (CORS) Policy Guide

This guide details OphirPay's Cross-Origin Resource Sharing (CORS) policy, preflight handling, allowed HTTP methods and headers, and integration patterns for frontend decentralized applications (dApps) and third-party payment widgets.

---

## Table of Contents

- [Overview & Security Architecture](#overview--security-architecture)
- [CORS Configuration & Environment Variables](#cors-configuration--environment-variables)
- [Preflight Request & Response Headers](#preflight-request--response-headers)
  - [Preflight Request (`OPTIONS`)](#preflight-request-options)
  - [Preflight Response Headers](#preflight-response-headers)
- [Credentials & Wildcard Protection](#credentials--wildcard-protection)
- [Cross-Origin Mutation Protection](#cross-origin-mutation-protection)
- [External Integrator Example (dApp Payment Widget)](#external-integrator-example-dapp-payment-widget)
- [Troubleshooting & Common Errors](#troubleshooting--common-errors)

---

## Overview & Security Architecture

OphirPay enforces strict, dynamic CORS origin validation at the edge proxy layer ([`src/proxy.ts`](../../src/proxy.ts)) and through the shared CORS utility ([`src/lib/cors.ts`](../../src/lib/cors.ts)).

The architecture balances two critical requirements:

1. **Public Integration**: Permitting authorized external frontend dApps, wallets, and checkout widgets to query payment statuses and initiate payments from external web origins.
2. **CSRF & Origin Isolation**: Preventing unauthorized third-party websites from executing state-changing mutations (`POST`, `PUT`, `DELETE`, `PATCH`) using a victim's active session cookie or credentials.

In addition, [`next.config.ts`](../../next.config.ts) configures the static HTTP response headers for the API boundary:

```typescript
{
  source: "/api/(.*)",
  headers: [
    { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
    { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
  ],
}
```

---

## CORS Configuration & Environment Variables

Allowed origins are dynamically resolved at runtime using the following environment variables:

| Variable              | Description                                                                | Example                                                 |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ALLOWED_ORIGINS`     | Comma-, semicolon-, or space-separated list of permitted external origins. | `https://dapp.example.com, https://checkout.partner.io` |
| `NEXT_PUBLIC_APP_URL` | Base canonical application URL (automatically included in the allowlist).  | `https://ophirpay.com`                                  |

### Normalization Rules

Origins are strictly normalized upon ingestion:

- Protocol and hostname are converted to lowercase.
- Trailing slashes are stripped (e.g., `https://example.com/` becomes `https://example.com`).
- Ports are preserved if non-standard (e.g., `http://localhost:3000`).

### Local Development Fallbacks

When running locally (`NODE_ENV !== "production"`) with no explicit `ALLOWED_ORIGINS` configured, the server automatically permits:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:3001`

---

## Preflight Request & Response Headers

Browsers automatically issue an HTTP `OPTIONS` preflight request when an external script attempts a cross-origin request involving custom headers (such as `Authorization` or `X-API-Key`) or methods other than `GET`/`HEAD`.

### Preflight Request (`OPTIONS`)

When an incoming preflight request matches an authorized origin in `ALLOWED_ORIGINS`:

- **Status Code**: `204 No Content`
- **Correlation**: Returns `X-Request-Id` for tracing in server logs.

If the origin is **not** authorized:

- **Status Code**: `403 Forbidden`
- **Response Body**:
  ```json
  {
    "success": false,
    "error": {
      "code": "FORBIDDEN",
      "message": "CORS preflight origin not allowed"
    }
  }
  ```

### Preflight Response Headers

Authorized preflight responses emit the following standard headers:

| Header                             | Configured Value                                                                 | Purpose                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Access-Control-Allow-Origin`      | Echoes the request's exact normalized origin (e.g., `https://dapp.example.com`). | Informs the browser that this specific origin is permitted.                                    |
| `Access-Control-Allow-Methods`     | `GET, POST, PUT, DELETE, PATCH, OPTIONS`                                         | Permitted HTTP verbs on the API.                                                               |
| `Access-Control-Allow-Headers`     | `Content-Type, Authorization, X-API-Key, X-Request-Id, X-CSRF-Token`             | Permitted request headers.                                                                     |
| `Access-Control-Max-Age`           | `86400` (24 hours)                                                               | Caches the preflight response in the browser, eliminating round-trips for subsequent requests. |
| `Access-Control-Allow-Credentials` | `true`                                                                           | Allows cookies and Authorization headers to accompany cross-origin calls.                      |
| `Vary`                             | `Origin`                                                                         | Informs intermediary caches that responses differ based on the incoming `Origin`.              |

---

## Credentials & Wildcard Protection

> [!CAUTION]
> **Strict Wildcard Isolation (`#1393`)**
>
> Under the W3C CORS specification, an API must **never** return `Access-Control-Allow-Origin: *` alongside `Access-Control-Allow-Credentials: true`. Doing so allows arbitrary websites to read authenticated user data.
>
> In OphirPay:
>
> - If `ALLOWED_ORIGINS` contains `*` but the request requires credentials (`allowCredentials: true`), the request is **strictly rejected**.
> - Legitimate cross-origin dApps must have their specific origin listed in `ALLOWED_ORIGINS`.

---

## Cross-Origin Mutation Protection

For state-changing HTTP mutation methods (`POST`, `PUT`, `DELETE`, `PATCH`):

- If a request supplies an `Origin` header that is **not** present in `ALLOWED_ORIGINS`, OphirPay immediately intercepts the request before route execution.
- Returns `HTTP 403 Forbidden`:
  ```json
  {
    "success": false,
    "error": {
      "code": "FORBIDDEN",
      "message": "Cross-origin request blocked: origin not allowed"
    }
  }
  ```

This ensures that attackers cannot trigger malicious payments or mutate API keys from unauthorized websites, even if they bypass simple browser checks.

---

## External Integrator Example (dApp Payment Widget)

The following example demonstrates how a frontend dApp or payment checkout widget connects to an OphirPay deployment:

```typescript
// SPDX-License-Identifier: MIT

interface CreatePaymentParams {
  amount: string;
  asset: string;
  payee: string;
  memo?: string;
}

interface PaymentResponse {
  success: boolean;
  data?: {
    id: string;
    status: string;
    txHash?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Initiates a payment via OphirPay from an external dApp origin.
 */
export async function createPaymentCrossdomain(
  apiBaseUrl: string,
  apiKey: string,
  params: CreatePaymentParams
): Promise<PaymentResponse> {
  const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/api/payments`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Request-Id": crypto.randomUUID(),
      },
      // Enables credentials if integrating with an authenticated session
      credentials: "include",
      body: JSON.stringify(params),
    });

    if (response.status === 403) {
      const errorData = await response.json();
      console.error("[OphirPay CORS Error] Origin blocked:", errorData.error?.message);
      throw new Error(`CORS origin blocked: ${errorData.error?.message}`);
    }

    const data: PaymentResponse = await response.json();
    return data;
  } catch (err) {
    console.error("[OphirPay Client] Cross-origin payment failed:", err);
    throw err;
  }
}
```

---

## Troubleshooting & Common Errors

### 1. `CORS preflight origin not allowed (403)`

- **Cause**: The domain hosting your frontend is not in the server's `ALLOWED_ORIGINS` environment variable.
- **Fix**: Add your domain (e.g. `https://dapp.example.com`) to `ALLOWED_ORIGINS` in `.env.local` or Kubernetes ConfigMap, then restart the server.

### 2. Missing `Access-Control-Allow-Headers`

- **Cause**: Sending a custom header that is not in `Content-Type, Authorization, X-API-Key, X-Request-Id, X-CSRF-Token`.
- **Fix**: Only pass documented headers or configure upstream reverse proxy headers.

### 3. Trailing Slash Mismatch

- **Cause**: Submitting an origin formatted as `https://example.com/` instead of `https://example.com`.
- **Fix**: The server automatically normalizes origins, but ensure your reverse proxy or CDN does not inject trailing slashes into the `Origin` header.
