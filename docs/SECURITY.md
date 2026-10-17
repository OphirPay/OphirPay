# Content Security Policy (CSP) & Strict Security Headers

This document outlines the Content Security Policy (CSP) directives, strict HTTP transport/framing security headers, and maintenance procedures enforced by OphirPay (`src/lib/security-headers.ts`, `src/lib/proxy-config.ts`, and `src/proxy.ts`).

## Static & Per-Request Security Headers

Every document and API response is protected with the following security headers:

| Header | Value | Purpose |
| --- | --- | --- |
| `Content-Security-Policy` | Per-request nonce-based policy for web documents; strict `default-src 'none'; frame-ancestors 'none'` for API routes | Blocks XSS, unauthorized external scripts, and framing attacks |
| `X-Frame-Options` | `DENY` | Prevents clickjacking across legacy and modern browsers |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing of scripts and stylesheets |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage on cross-origin navigation |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()` | Disables sensitive browser hardware APIs and FLoC/Topics tracking |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforces HTTPS across all subdomains |
| `X-XSS-Protection` | `0` | Disables legacy browser XSS auditor to avoid filter-induced side channels |

## Content Security Policy (CSP) Directives

### Document Routes (`/`, `/dashboard`, `/payments`, etc.)

- `default-src 'self'`
- `script-src 'self' 'nonce-<per-request>' 'strict-dynamic' 'wasm-unsafe-eval'` (plus `'unsafe-eval'` in development only for Next.js Fast Refresh; `'unsafe-inline'` is never permitted)
- `style-src 'self' 'unsafe-inline'`
- `connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so`
- `img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com`
- `font-src 'self'`
- `frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:`
- `object-src 'none'`
- `base-uri 'self'`
- `form-action 'self'`
- `frame-ancestors 'none'`
- `report-to csp-endpoint; report-uri /api/csp-report`

### API & Webhook Routes (`/api/*`)

API routes return JSON or SSE payloads and enforce a locked-down policy:

```text
default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
```

## Nonce Generation & Script Hash Verification

- **Per-Request Nonces**: `generateCspNonce()` mints a fresh 128-bit base64 nonce on each HTML request and forwards it via the `x-nonce` request header so Next.js App Router stamps `nonce="..."` on framework scripts.
- **Script Hash Verification**: When deterministic inline script snippets require hash-based allowlisting, use `computeScriptSha256Hash(script)` and `verifyScriptHash(script, expectedHash)` from `src/lib/security-headers.ts` and pass `scriptHashes` to `buildStrictCspHeader({ nonce, scriptHashes })`.

## Maintenance Instructions

1. **Adding a New Stellar RPC or Wallet Domain**:
   - Update `CSP_POLICY.connectSrc` or `CSP_POLICY.frameSrc` in `src/lib/proxy-config.ts` (re-exported as `STELLAR_CONNECT_ORIGINS` and `WALLET_FRAME_ORIGINS` in `src/lib/security-headers.ts`).
2. **Verifying Security Headers**:
   - Run `npx vitest run tests/middleware/security-headers.test.ts src/__tests__/security-headers.test.ts`.
