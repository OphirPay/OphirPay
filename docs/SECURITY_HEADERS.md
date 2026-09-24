# 🛡️ Security Headers Policy & Reference

> **Authoritative specification of HTTP security headers for OphirPay across Vercel, Docker, and standalone deployments.**

This document details the intended security headers for OphirPay, specifies the authoritative layer where each header is defined, details deliberate policy relaxations with their architectural justifications, and provides verification procedures using `curl`.

---

## 1. Master Security Header Matrix

| Header | Intended Value | Authoritative Source | Deployment Layer | Rationale / Compliance |
| :--- | :--- | :--- | :--- | :--- |
| **`Content-Security-Policy`** | *Dynamic (strict whitelist, see §2)* | `src/proxy.ts` | All runtime requests (Edge/Node) | Restricts resource loading, script execution, wallet frame injection, and RPC network endpoints. |
| **`Strict-Transport-Security`** | `max-age=63072000; includeSubDomains; preload` | `next.config.ts` | HTTPS Production (Vercel & Docker TLS) | Enforces TLS across all subdomains with HSTS preload eligibility (2 years). |
| **`X-Content-Type-Options`** | `nosniff` | `next.config.ts` / `vercel.json` | All responses | Prevents MIME-sniffing and executable interpretation of non-executable MIME types. |
| **`X-Frame-Options`** | `DENY` | `next.config.ts` / `vercel.json` | All responses | Protects against UI redressing, clickjacking, and frame-based attacks. |
| **`X-XSS-Protection`** | `0` | `next.config.ts` / `vercel.json` | All responses | Disables legacy, buggy XSS auditor filters in older browsers that introduce side-channel vulnerabilities (OWASP standard). |
| **`Referrer-Policy`** | `strict-origin-when-cross-origin` | `next.config.ts` / `vercel.json` | All responses | Protects URL path privacy when navigating cross-origin while preserving origin on HTTPS. |
| **`Permissions-Policy`** | `camera=(), microphone=(), geolocation=(), payment=()` | `next.config.ts` / `vercel.json` | All responses | Disables sensitive browser hardware APIs and delegations not utilized by the dApp. |
| **`Cross-Origin-Opener-Policy`** | `same-origin` | `next.config.ts` | HTML / Document responses | Isolates browsing context from cross-origin documents to protect against Spectre-style cross-origin data leaks. |
| **`Cross-Origin-Resource-Policy`** | `same-origin` (Pages)<br>`cross-origin` (`/api/*`) | `next.config.ts` | Standalone Node / Docker | Blocks cross-origin no-cors reads for app assets while permitting external client integrations for `/api/*`. |
| **`Cache-Control`** | `no-cache, no-store, must-revalidate` | `next.config.ts` (`/api/*`) | API endpoints | Prevents caching of blockchain transaction balances, authorization states, and audit trails. |
| **`Cache-Control`** | `public, max-age=31536000, immutable` | `vercel.json` (`/_next/static/*`) | Static assets (1 year) | Optimizes performance for content-hashed static bundles. |

---

## 2. Content-Security-Policy (CSP) Architecture

The `Content-Security-Policy` header is generated dynamically on every incoming request in `src/proxy.ts` (not statically in `next.config.ts`) to ensure per-request validation and strict origin filtering.

### Production Directives (`NODE_ENV === "production"`)

```http
default-src 'self';
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so;
img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com;
font-src 'self';
frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
block-all-mixed-content;
upgrade-insecure-requests;
```

---

## 3. Deliberate Policy Relaxations & Technical Rationale

Every intentional departure from zero-trust policy is explicitly documented and tracked:

### 1. `script-src: 'unsafe-inline'`
* **Reason:** Next.js (App Router) generates and injects inline streaming and client hydration scripts for server-rendered components.
* **Why not nonces?** Next.js 16 build does not reliably propagate per-request nonce headers to streaming RSC component trees without hydration mismatch crashes (tracked in Issue #781).
* **Mitigating Controls:** All other script vectors are strictly locked down: `default-src 'self'`, `object-src 'none'`, and `base-uri 'self'`.

### 2. `script-src: 'wasm-unsafe-eval'`
* **Reason:** Stellar and Soroban client-side SDKs (`@stellar/stellar-sdk`, ed25519 signature validation) execute WebAssembly modules for high-performance cryptographic operations.
* **Standard:** W3C Content Security Policy Level 3 explicitly reserves `'wasm-unsafe-eval'` for WebAssembly instantiation while forbidding arbitrary JS `eval()`.

### 3. `script-src: 'unsafe-eval'` (Development Only)
* **Reason:** React Fast Refresh and Hot Module Replacement (HMR) require dynamic function compilation during local development.
* **Scope:** Enforced **only** when `process.env.NODE_ENV !== "production"`. It is completely stripped in production builds.

### 4. `style-src: 'unsafe-inline'`
* **Reason:** Dynamic CSS variable injection for theme switching (light/dark) and Tailwind CSS utility styling.

### 5. `frame-src: https://*.freighter.app chrome-extension: moz-extension:`
* **Reason:** Stellar wallet browser extensions (Freighter, Albedo, Lobstr) use browser extension URI schemes to securely orchestrate transaction signing popups.

---

## 4. Multi-Layer Precedence & Resolution Rules

OphirPay supports two primary production deployment topologies:

1. **Vercel Serverless / Edge Deployment:**
   * `vercel.json` headers are evaluated at the Vercel routing edge.
   * `next.config.ts` headers are applied by the Next.js server engine.
   * `src/proxy.ts` executes per-request, setting the authoritative `Content-Security-Policy` and overriding duplicate headers where applicable.
   * **Rule:** If a header is defined in both `vercel.json` and `next.config.ts`, values must be synchronized (`X-XSS-Protection: 0`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`) to ensure identical behavior regardless of platform routing.

2. **Docker / Standalone Node.js Deployment:**
   * `next.config.ts` is the authoritative source for all static response headers.
   * `src/proxy.ts` injects the dynamic CSP and per-request security context.
   * In containerized deployments behind an external ingress (e.g. NGINX, Cloudflare, Traefik), TLS termination handles `Strict-Transport-Security`.

---

## 5. Verification Runbook (curl)

To verify the effective security headers on any running environment, run the following audit commands:

### 1. Verify Page Security Headers & CSP
```bash
curl -sI https://your-deployment-domain.com | grep -Ei "^(content-security-policy|x-content-type-options|x-frame-options|x-xss-protection|referrer-policy|permissions-policy|strict-transport-security|cross-origin)"
```

**Expected Output:**
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Cross-Origin-Opener-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; ...
```

### 2. Verify API No-Cache & Cross-Origin Headers
```bash
curl -sI https://your-deployment-domain.com/api/health
```

**Expected API Headers:**
```http
Cache-Control: no-cache, no-store, must-revalidate
Cross-Origin-Resource-Policy: cross-origin
```

### 3. Verify Static Asset Cache Invariance
```bash
curl -sI https://your-deployment-domain.com/_next/static/chunks/main.js | grep -i "cache-control"
```

**Expected Static Cache:**
```http
Cache-Control: public, max-age=31536000, immutable
```
