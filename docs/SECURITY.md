# HTTP Security Headers & Content Security Policy (CSP) Specification

This document details the HTTP security headers, Content Security Policy (CSP) directives, and maintenance procedures enforced across OphirPay web applications and API services (Issue #1310).

---

## 1. Overview & Defense-in-Depth

OphirPay applies strict security headers at the Edge middleware layer (`src/middleware.ts` delegating to `src/proxy.ts` and `src/lib/security-headers.ts`). All incoming requests and outgoing responses are processed to eliminate common web vulnerabilities including:

- **Clickjacking & UI Redressing**: Mitigated via `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- **MIME Confusion & Sniffing**: Mitigated via `X-Content-Type-Options: nosniff`.
- **Information Leakage**: Mitigated via `Referrer-Policy: strict-origin-when-cross-origin`.
- **Hardware Device Exploitation**: Mitigated via `Permissions-Policy` disabling camera, microphone, geolocation, and browsing topics.
- **Cross-Site Scripting (XSS)**: Mitigated via dynamic per-request cryptographic nonces and strict CSP directives.
- **Man-in-the-Middle (MitM)**: Mitigated via `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` in production environments.

---

## 2. Standard HTTP Security Headers

| Header | Production Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents browsers from MIME-sniffing away from declared `Content-Type`. |
| `X-Frame-Options` | `DENY` | Prevents embedding in any `<frame>`, `<iframe>`, or `<object>`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Sends origin only to cross-origin destinations when TLS level is preserved. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` | Disables access to sensitive hardware interfaces and tracking APIs. |
| `X-DNS-Prefetch-Control` | `off` | Prevents speculative external DNS lookups. |
| `X-Download-Options` | `noopen` | Forces IE/Edge to download HTML/executable files rather than run directly. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates the browsing context from cross-origin documents. |
| `Cross-Origin-Resource-Policy`| `same-origin` | Restricts resource loading to identical origins. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforces HTTPS connections for 2 years with HSTS preload. |

---

## 3. Content Security Policy (CSP) Architecture

### Dynamic Nonce Generation
Every HTML document request is assigned a unique, cryptographically random 128-bit base64 nonce (`crypto.randomUUID()` in Edge runtime). 
- Nonces are propagated to the App Router renderer via the `Content-Security-Policy` request header and `x-nonce` request header.
- Static `'unsafe-inline'` is strictly omitted from `script-src` in production.
- Fast Refresh and local HMR dynamically add `'unsafe-eval'` solely under `NODE_ENV === "development"`.

### Directive Breakdown

```http
default-src 'self';
script-src 'self' 'nonce-<dynamic-nonce>' 'strict-dynamic' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so;
img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com;
font-src 'self';
frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:;
object-src 'none';
base-uri 'self';
form-action 'self';
report-to csp-endpoint;
report-uri /api/csp-report;
```

### Stellar Ecosystem & Wallet Integration
- **Connect-src**: Authorizes all canonical Stellar Horizon and Soroban RPC nodes across Public Mainnet, Testnet, and Futurenet.
- **Frame-src**: Authorizes wallet browser extensions (Freighter, xBull, Albedo, etc.) via `chrome-extension:` and `moz-extension:` schemes.
- **WASM Support**: Includes `'wasm-unsafe-eval'` required by WebAssembly parsing in Soroban client SDKs.

---

## 4. Maintenance & Adding New Domains

When integrating external analytics, alternative RPC nodes, or wallet popups:

1. Locate `CSP_POLICY` in `src/lib/proxy-config.ts` or `src/lib/security-headers.ts`.
2. Append the new domain strictly to the least privileged directive (`connectSrc` for APIs, `imgSrc` for asset CDNs, `frameSrc` for modals).
3. Run the automated test suite:
   ```bash
   npx vitest run src/__tests__/security-headers.test.ts
   ```
4. Verify zero CSP violation reports are received on `/api/csp-report`.
