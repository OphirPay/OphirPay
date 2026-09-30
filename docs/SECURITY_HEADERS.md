# Security Header Policy

This document defines the HTTP security header architecture, authoritative sources, intended values, deployment layer scopes, and deliberate policy relaxations for OphirPay.

---

## Architectural Overview

OphirPay separates HTTP header enforcement across three distinct architectural layers to prevent configuration drift between local development, Vercel deployments, Docker containers, Kubernetes clusters, and standalone Node.js runtimes:

1. **Static Baseline Headers and Cache Control (`next.config.ts`)**:
   Acts as the single source of truth for all static response headers across all deployment targets (issue #681, issue #740). It declares baseline browser protections across all paths (`/(.*)`) and content-addressed cache rules for static assets (`/_next/static/(.*)`, `/_next/image`, `/api/(.*)`). Because these headers are compiled into the Next.js routing layer, self-hosted and cloud platforms emit identical headers.
2. **Dynamic Request Proxy (`src/proxy.ts`)**:
   Runs on the Edge runtime as the dynamic request interceptor. It evaluates per-request state, dynamically computes the `Content-Security-Policy` (CSP) based on environment (`NODE_ENV`), injects modern W3C Reporting API headers (`Report-To`, `Reporting-Endpoints`), enforces rate limiting, and attaches request correlation identifiers (`X-Request-Id`).
3. **Platform Deployment Manifest (`vercel.json`)**:
   Restricted purely to platform routing, region configuration, and build commands. Declaring HTTP headers in `vercel.json` is strictly forbidden to prevent precedence conflicts and environment drift against `next.config.ts` (issue #681, issue #740).

---

## Authoritative Security Header Matrix

| Header | Authoritative Source | Intended Value | Target Scope | Security Objective and Rationale |
|---|---|---|---|---|
| `X-Content-Type-Options` | `next.config.ts` | `nosniff` | All routes (`/(.*)`) | Prevents MIME-type sniffing by browsers, mitigating MIME-confusion attacks and executable content masquerading. |
| `X-Frame-Options` | `next.config.ts` | `DENY` | All routes (`/(.*)`) | Clickjacking protection. Disallows framing of OphirPay within `<iframe>`, `<frame>`, `<embed>`, or `<object>` by any external or internal origin. |
| `X-XSS-Protection` | `next.config.ts` | `0` | All routes (`/(.*)`) | Disables legacy, buggy browser XSS filter heuristics (IE/older Chrome) that introduce cross-site scripting vulnerabilities. Modern protection is enforced by CSP (issue #681). |
| `Referrer-Policy` | `next.config.ts` | `strict-origin-when-cross-origin` | All routes (`/(.*)`) | Sends origin, path, and query on same-origin requests; sends origin only on cross-origin HTTPS requests; omits referrer header on protocol downgrades. |
| `Permissions-Policy` | `next.config.ts` | `camera=(), microphone=(), geolocation=(), payment=()` | All routes (`/(.*)`) | Disables unauthorized hardware access (camera, microphone, location) and disables browser Payment Request API (OphirPay uses Stellar wallet signing). |
| `Strict-Transport-Security` | `next.config.ts` | `max-age=63072000; includeSubDomains; preload` | All routes (`/(.*)`) | Enforces HTTPS communication for two years across all subdomains and authorizes inclusion in browser HSTS preload lists. |
| `Cross-Origin-Opener-Policy` | `next.config.ts` | `same-origin` | All routes (`/(.*)`) | Isolates browsing context from cross-origin windows, mitigating Spectre side-channel attacks and window hijacking. |
| `Cross-Origin-Resource-Policy` | `next.config.ts` | `same-origin` (Pages/Assets)<br>`cross-origin` (`/api/*`) | `/(.*)` default<br>`/api/(.*)` override | Blocks cross-origin reads of static assets and HTML pages; explicitly relaxed for API endpoints so external integration clients can consume responses. |
| `Content-Security-Policy` | `src/proxy.ts` | See CSP breakdown below | HTML pages (non-API) | Restricts authorized script, style, connection, image, and frame origins; controls violation reporting endpoints (issue #697, issue #698). |
| `Report-To` | `src/proxy.ts` | `{"group":"csp-endpoint","max_age":10886400,"endpoints":[{"url":"/api/csp-report"}],"include_subdomains":false}` | HTML pages | Configures the legacy Reporting API group for Chromium 70+ browsers, targeting `POST /api/csp-report` (issue #698). |
| `Reporting-Endpoints` | `src/proxy.ts` | `csp-endpoint="/api/csp-report"` | HTML pages | Configures the modern W3C Reporting API endpoint for Chromium 96+ browsers, targeting `POST /api/csp-report` (issue #698). |
| `Cache-Control` | `next.config.ts` | `public, max-age=31536000, immutable` | `/_next/static/(.*)` | Content-addressed static build assets are immutable and safely cached for 1 year across all hosting targets (issue #740). |
| `Cache-Control` | `next.config.ts` | `public, max-age=3600, stale-while-revalidate=86400` | `/_next/image` | Optimized image assets receive a short 1-hour cache duration with 24-hour background stale-while-revalidate revalidation. |
| `Cache-Control` | `next.config.ts` | `no-cache, no-store, must-revalidate` | `/api/(.*)` | Prevents browsers, proxies, and CDNs from caching financial and transactional API data. |
| `X-Request-Id` | `src/proxy.ts` | `req_<timestamp>_<random>` | `/api/(.*)` and HTML | Propagates unique request correlation identifier through upstream and downstream headers for audit trails. |
| `X-Api-Version` | `src/proxy.ts` | `1.0.0` | `/api/(.*)` and HTML | Identifies the active OphirPay API contract version. |
| `X-RateLimit-Limit` | `src/proxy.ts` | Configured RPM limit (default `120`) | `/api/(.*)` | Observability header indicating maximum allowed requests per minute. |
| `X-RateLimit-Remaining` | `src/proxy.ts` | Decrementing integer counter | `/api/(.*)` | Remaining requests allowed in the current 1-minute window. |
| `X-RateLimit-Reset` | `src/proxy.ts` | Unix epoch timestamp (seconds) | `/api/(.*)` | Expiration timestamp when the current rate limit window resets. |
| `Access-Control-Allow-Origin` | `src/proxy.ts` | Origin or `*` (restricted in production) | `/api/(.*)` | Restricts cross-origin resource sharing to authorized origins in production while permitting local origins during development. |
| `Access-Control-Allow-Methods` | `src/proxy.ts` | `GET, POST, PUT, DELETE, OPTIONS` | `/api/(.*)` | Explicitly allowed HTTP methods for API interactions. |
| `Access-Control-Allow-Headers` | `src/proxy.ts` | `Content-Type, Authorization, X-API-Key` | `/api/(.*)` | Explicitly authorized client request headers. |

---

## Content-Security-Policy (CSP) Specification

The `Content-Security-Policy` header is generated dynamically per request in `src/proxy.ts`.

### Directives Breakdown

| Directive | Configured Sources | Purpose and Justification |
|---|---|---|
| `default-src` | `'self'` | Fallback default restricting resource loading to same-origin only. |
| `script-src` | `'self' 'unsafe-inline' 'wasm-unsafe-eval'` (Prod)<br>`'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'` (Dev) | Permits application scripts, Next.js hydration bootstrap scripts, Soroban WASM evaluation, and development HMR (issue #697). |
| `style-src` | `'self' 'unsafe-inline'` | Permits application CSS and Tailwind CSS dynamic utility styling. |
| `connect-src` | `'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so` | Whitelists required Stellar Horizon REST nodes, Soroban RPC nodes, and Pulse RPC for on-chain contract queries. |
| `img-src` | `'self' data: https://stellar.expert https://raw.githubusercontent.com` | Permits local assets, base64 data URIs (QR codes for wallet pairing), and external asset icons from Stellar Expert and GitHub. |
| `font-src` | `'self'` | Restricts font loading to local application font bundles. |
| `frame-src` | `'self' https://*.freighter.app chrome-extension: moz-extension:` | Allows embedding Freighter wallet popups and browser extension frames (Freighter, xBull, Albedo). |
| `object-src` | `'none'` | Disallows legacy plugins (Flash, Java, Silverlight). |
| `base-uri` | `'self'` | Prevents unauthorized modification of document base URI tags. |
| `form-action` | `'self'` | Restricts form submission targets to same-origin endpoints. |
| `report-to` | `csp-endpoint` | Routes violation reports to the W3C Reporting API collector group. |
| `report-uri` | `/api/csp-report` | Legacy fallback directive routing violation reports to `POST /api/csp-report` (issue #698). |

---

## Deliberate Relaxations and Tracking Issues

Every deviation from the strictest possible security policy is intentional, technically justified, and tracked under an issue:

### 1. `script-src 'unsafe-inline'` (Issue #697)
- **Relaxation**: Inline script execution is allowed in production.
- **Root Cause**: The Next.js 16 App Router injects server-rendered streaming bootstrap scripts and hydration payloads (`__NEXT_DATA__` and React Server Components flight payloads) into the initial HTML document. In Next.js 16, a per-request nonce assigned in middleware (`src/proxy.ts`) does not propagate down to the App Router renderer.
- **Impact without relaxation**: Browser CSP blocks Next.js hydration scripts, immediately breaking client-side interactivity across the entire application.
- **Resolution Plan**: Re-test nonce propagation on future Next.js releases (upstream Next.js issue #74803). Once end-to-end nonce propagation is verified in production, replace `'unsafe-inline'` with per-request `'nonce-...'`.

### 2. `script-src 'wasm-unsafe-eval'`
- **Relaxation**: WebAssembly code execution is permitted.
- **Root Cause**: Soroban smart contract interaction and Stellar cryptographic verification libraries utilize WebAssembly modules for client-side cryptographic hashing and signature validation.
- **Security Assessment**: `wasm-unsafe-eval` is scoped solely to WebAssembly binaries and does not permit arbitrary JavaScript evaluation (`eval`).

### 3. `script-src 'unsafe-eval'` (Development Only)
- **Relaxation**: JavaScript `eval()` execution is enabled conditionally when `process.env.NODE_ENV !== "production"`.
- **Root Cause**: Next.js development mode, Webpack, and Turbopack rely on `eval()` source mapping for Fast Refresh and Hot Module Replacement (HMR).
- **Enforcement**: Strictly blocked in production; `src/proxy.ts` omits `'unsafe-eval'` whenever `NODE_ENV === "production"`.

### 4. `style-src 'unsafe-inline'`
- **Relaxation**: Inline style attributes and style tags are permitted.
- **Root Cause**: Tailwind CSS v4, component transition libraries, and dynamic layout calculations inject CSS rules and inline style attributes during DOM rendering.

### 5. `frame-src chrome-extension: moz-extension: https://*.freighter.app`
- **Relaxation**: External frames from browser extensions and Freighter domains are authorized.
- **Root Cause**: Non-custodial Stellar wallet authentication (Freighter, xBull) mounts UI communication iframes within the browser DOM during transaction signing.

### 6. `Cross-Origin-Resource-Policy: cross-origin` for `/api/(.*)`
- **Relaxation**: While the baseline CORP rule on `/(.*)` is `same-origin`, the API path `/api/(.*)` explicitly overrides this to `cross-origin`.
- **Root Cause**: Merchant checkouts, external dApps, and client SDKs require direct programmatic access to OphirPay API endpoints without being blocked by browser cross-origin resource policies.

### 7. `X-XSS-Protection: 0` (Issue #681)
- **Relaxation**: Legacy browser XSS auditor is explicitly disabled (`0`) rather than enabled (`1; mode=block`).
- **Root Cause**: Legacy XSS auditors in Internet Explorer and older WebKit browsers contain documented design flaws that allow attackers to trigger false-positive filtering to selectively disable legitimate application scripts (vulnerability known as XSS filter bypass/abuse). Modern standards (OWASP) mandate setting this header to `0` and relying exclusively on CSP.

---

## Deployment Layer Precedence and Parity

### Conflict Prevention Rule (`vercel.json` Non-Duplication)
Historically, `vercel.json` declared overlapping security headers with contradicting values (for example, setting `X-XSS-Protection: 1; mode=block` while `next.config.ts` set `0`). This caused non-deterministic behavior depending on deployment runtime.

Under the current architecture:
- `next.config.ts` is the single owner for static headers.
- `vercel.json` must declare zero headers.
- The unit test suite (`src/__tests__/security-headers.test.ts`) asserts that no header defined in `next.config.ts` is repeated in `vercel.json`.

### Self-Hosted and Container Parity
Whether running on Vercel Edge, Docker (`Dockerfile`), Kubernetes (`helm/ophirpay`), or standalone Node.js (`npm start`), the application routes through the same `next.config.ts` and `src/proxy.ts` pipeline. Reverse proxies (Nginx, Envoy, Cloudflare, Traefik) should forward origin headers without overwriting security or cache-control directives.

---

## Verification Runbook

Verify effective headers on a deployed environment using `curl`:

### 1. Verify HTML Page Security Headers and CSP
```bash
curl -sI https://ophirpay.com/ | grep -iE 'content-security-policy|x-content-type-options|x-frame-options|x-xss-protection|referrer-policy|strict-transport-security|cross-origin|permissions-policy|reporting-endpoints'
```
Expected output:
- `content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; ...`
- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `x-xss-protection: 0`
- `referrer-policy: strict-origin-when-cross-origin`
- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- `cross-origin-opener-policy: same-origin`
- `cross-origin-resource-policy: same-origin`
- `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()`
- `reporting-endpoints: csp-endpoint="/api/csp-report"`

### 2. Verify API Route Headers and CORP Relaxation
```bash
curl -sI https://ophirpay.com/api/health | grep -iE 'cache-control|cross-origin-resource-policy|x-request-id|x-api-version'
```
Expected output:
- `cache-control: no-cache, no-store, must-revalidate`
- `cross-origin-resource-policy: cross-origin`
- `x-request-id: req_...`
- `x-api-version: 1.0.0`

### 3. Verify Static Asset Cache Header
```bash
curl -sI https://ophirpay.com/_next/static/chunks/main.js | grep -iE 'cache-control|x-content-type-options'
```
Expected output:
- `cache-control: public, max-age=31536000, immutable`
- `x-content-type-options: nosniff`
