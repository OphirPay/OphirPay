# Security Headers Policy

This document defines the authoritative security header policy for OphirPay across all deployment targets (Vercel edge, Docker container, and standalone Node.js).

---

## 1. Architecture & Layer Precedence

Security headers in OphirPay are enforced across two complementary layers:

1. **Application Proxy Layer (`src/proxy.ts`)**:
   - Executes on the Edge runtime before route handling.
   - Computes dynamic per-request headers: request tracking (`X-Request-Id`), rate-limiting metadata (`X-RateLimit-*`), dynamic CORS headers, and the per-request `Content-Security-Policy` (CSP) for HTML pages.
2. **Next.js Engine Configuration (`next.config.ts`)**:
   - Single source of truth for static security headers (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`) and cache policies (`/_next/static/*`, `/_next/image`, `/api/*`).
   - Ensures self-hosted Docker/Kubernetes instances and Vercel edge deployments emit identical baseline protection (issue #681, issue #740).
3. **Platform Configuration (`vercel.json`)**:
   - Configures build commands, regions, and redirects.
   - **Does not duplicate** security headers declared in `next.config.ts`, eliminating precedence drift (enforced by `src/__tests__/security-headers.test.ts`).

---

## 2. Authoritative Security Header Matrix

Every security-relevant response header is defined in the table below with its authoritative source, scope, and purpose:

| Header | Intended Value | Authoritative Source | Target Scope | Rationale & Security Objectives |
|---|---|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' [...]; ...` | `src/proxy.ts` | HTML Pages (`/(.*)` excluding assets) | Restricts resource loading to trusted origins, prevents XSS, limits frame injection to approved wallet extensions, and disables unauthorized plugin execution (`object-src 'none'`). |
| `X-Content-Type-Options` | `nosniff` | `next.config.ts` (static) / `src/proxy.ts` (API fallback) | All responses (`/(.*)`) | Prevents MIME-type sniffing by browsers, stopping executable script execution from user-uploaded or text content. |
| `X-Frame-Options` | `DENY` | `next.config.ts` (static) / `src/proxy.ts` (API fallback) | All responses (`/(.*)`) | Disables framing of the application, completely mitigating clickjacking attacks against user payment flows. |
| `X-XSS-Protection` | `0` | `next.config.ts` | All responses (`/(.*)`) | Deliberately disabled (`0`). The legacy Internet Explorer / old Chrome XSS auditor is deprecated and introduced side-channel vulnerabilities; modern browsers rely exclusively on CSP (issue #681). |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `next.config.ts` | All responses (`/(.*)`) | Sends full path referrers on same-origin requests but only the origin on cross-origin HTTPS requests, preventing sensitive payment or query metadata leakage. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | `next.config.ts` | All responses (`/(.*)`) | Restricts browser hardware and payment APIs from being accessed by embedded frames or scripts. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | `next.config.ts` | All responses (`/(.*)`) | Enforces HTTPS for 2 years (HSTS) across all subdomains and permits inclusion in browser HSTS preload lists. |
| `Cross-Origin-Opener-Policy` (COOP) | `same-origin` | `next.config.ts` | All responses (`/(.*)`) | Isolates the top-level browsing context from cross-origin popups, preventing cross-origin window object manipulation and Spectre-style memory leaks. |
| `Cross-Origin-Resource-Policy` (CORP) | `same-origin` (Pages) / `cross-origin` (`/api/*`) | `next.config.ts` | All routes / scoped per path | Restricts document and asset loads to same-origin while explicitly granting cross-origin consumption for authorized API endpoints. |
| `X-Powered-By` | *(Omitted)* | `next.config.ts` (`poweredByHeader: false`) | All responses | Stripped to avoid fingerprinting the framework version. |
| `X-Request-Id` | `req_<timestamp>_<random>` | `src/proxy.ts` | All requests & responses | Propagates a unique correlation ID for end-to-end tracing and error debugging across logs. |
| `X-Api-Version` | `1.0.0` | `src/proxy.ts` | API responses (`/api/*`) | Communicates API contract version to programmatic consumers. |
| `X-RateLimit-Limit` | Configurable (`RATE_LIMIT_RPM`, default `120`) | `src/proxy.ts` | API responses (`/api/*`) | Informs clients of current request burst limit per minute. |
| `X-RateLimit-Remaining` | Remaining requests integer | `src/proxy.ts` | API responses (`/api/*`) | Informs clients of remaining capacity before HTTP 429 throttling. |
| `X-RateLimit-Reset` | Epoch seconds integer | `src/proxy.ts` | API responses (`/api/*`) | Timestamp when the current rate-limiting window rolls over. |

---

## 3. Deliberate Policy Relaxations & Justification

To maintain compatibility with Next.js App Router, browser wallet extensions, and Stellar Soroban cryptography, certain policy directives contain deliberate, audited relaxations:

### 1. `script-src 'unsafe-inline'`
- **Reason:** Next.js App Router relies on inline scripts for server-driven React Server Component (RSC) streaming and client hydration. In Next.js 16, per-request nonce propagation through edge middleware (`src/proxy.ts`) to server component hydration payloads is not supported out-of-the-box without causing hydration mismatches.
- **Compensating Controls:** `default-src 'self'`, `object-src 'none'`, and strict `connect-src` allowlists prevent unauthorized script execution or exfiltration.
- **Tracking:** Tracked under Issue #697 for nonce restoration once upstream framework support matures.

### 2. `script-src 'wasm-unsafe-eval'`
- **Reason:** Soroban smart contract interaction libraries (`@stellar/stellar-sdk`, `soroban-client`) compile and execute WebAssembly primitives for Ed25519 signature verification and hashing within the browser.
- **Compensating Controls:** Scoped strictly to WASM evaluation; arbitrary string evaluation via `eval()` remains blocked in production.

### 3. `script-src 'unsafe-eval'` (Development Only)
- **Reason:** Required by Webpack and Turbopack for Fast Refresh / Hot Module Replacement (HMR) during local development.
- **Compensating Controls:** Guarded by `process.env.NODE_ENV === "production"`. In production builds, `'unsafe-eval'` is stripped completely.

### 4. `style-src 'unsafe-inline'`
- **Reason:** Required for Tailwind CSS runtime style injection, dynamic theme transitions, and Next.js font optimization.

### 5. `frame-src https://*.freighter.app chrome-extension: moz-extension:`
- **Reason:** Stellar browser wallets (Freighter, xBull, Rabet, Albedo) operate via browser extension protocols and webview iframes to confirm transaction signatures.

### 6. `connect-src` Allowlist
- **Allowed Origins:**
  - `https://horizon-testnet.stellar.org`
  - `https://horizon.stellar.org`
  - `https://soroban-testnet.stellar.org`
  - `https://soroban.stellar.org`
  - `https://rpc-futurenet.stellar.org`
  - `https://mainnet.soroban.rpc.pulse.so`
- **Reason:** Client applications need direct access to public Stellar Horizon and Soroban RPC nodes to broadcast transactions and read ledger state without leaking requests to untrusted third parties.

---

## 4. Verification Runbook

Verify that security headers are correctly emitted on any deployed environment using `curl`:

### Verify HTML Page Headers & CSP
```bash
curl -sI https://your-domain.com/ | grep -E -i "(content-security-policy|x-frame-options|x-content-type-options|strict-transport-security|referrer-policy|permissions-policy|cross-origin)"
```

Expected output includes:
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; ...
```

### Verify API Route Headers & CORS
```bash
curl -sI https://your-domain.com/api/health | grep -E -i "(x-request-id|x-ratelimit|access-control|cache-control)"
```

Expected output includes:
```http
X-Request-Id: req_...
Cache-Control: no-cache, no-store, must-revalidate
Cross-Origin-Resource-Policy: cross-origin
```

### Verify Static Asset Caching
```bash
curl -sI https://your-domain.com/_next/static/test | grep -i "cache-control"
```

Expected output:
```http
Cache-Control: public, max-age=31536000, immutable
```
