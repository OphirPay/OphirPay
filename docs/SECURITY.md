# Security Headers & Content Security Policy

This document explains the HTTP security headers OphirPay serves, the
nonce-based Content Security Policy (CSP) for dashboard pages, and how to
change either safely. For the layer-by-layer deployment view (Vercel vs.
self-hosted, API overrides, and how to inspect a live response), see
[SECURITY_HEADERS.md](SECURITY_HEADERS.md).

## Where the policy lives

| File                          | Responsibility                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/security-headers.ts` | Baseline header names and values shared by both layers.                                                                                                  |
| `next.config.ts`              | Applies the baseline headers statically to every route; owns path-specific cache/CORP rules.                                                             |
| `src/proxy.ts`                | Re-applies the baseline headers per request (including early 401/403/429 responses) and sets the per-request CSP + reporting headers on document routes. |
| `src/lib/proxy-config.ts`     | `CSP_POLICY` (reviewable origin allowlists) and `buildCsp(nonce)`.                                                                                       |

`vercel.json` deliberately declares **no** security headers. The application
layer is the single owner, so a deployed response cannot depend on which layer
ran last.

## Baseline headers

Every document and API response carries:

| Header                         | Value                                                  | Purpose                                                                             |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `X-Content-Type-Options`       | `nosniff`                                              | Stop MIME-type sniffing.                                                            |
| `X-Frame-Options`              | `DENY`                                                 | Clickjacking defence for legacy browsers.                                           |
| `X-XSS-Protection`             | `0`                                                    | Disable the deprecated XSS filter (it has itself been abused).                      |
| `Referrer-Policy`              | `strict-origin-when-cross-origin`                      | Limit referrer detail on cross-origin navigation.                                   |
| `Permissions-Policy`           | `camera=(), microphone=(), geolocation=(), payment=()` | Disable browser capabilities the app does not use.                                  |
| `Strict-Transport-Security`    | `max-age=63072000; includeSubDomains; preload`         | Require HTTPS after the first secure response (browsers ignore it over plain HTTP). |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                          | Isolate top-level browsing contexts.                                                |
| `Cross-Origin-Resource-Policy` | `same-origin`, `cross-origin` on `/api/*`              | Allow API responses to be read under the API CORS policy.                           |

## Content Security Policy (document routes)

`src/proxy.ts` mints a fresh 128-bit nonce for every HTML request. It puts the
policy on the **request** headers (so the App Router renderer can stamp
`nonce="…"` on framework scripts) and on the response. The nonce also reaches
`src/app/layout.tsx` through `x-nonce` for the inline theme-bootstrap script.

```text
default-src 'self'
script-src 'self' 'nonce-<per-request>' 'strict-dynamic' 'wasm-unsafe-eval'
style-src 'self' 'unsafe-inline'
connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org https://rpc-futurenet.stellar.org https://mainnet.soroban.rpc.pulse.so
img-src 'self' data: https://stellar.expert https://raw.githubusercontent.com
font-src 'self'
frame-src 'self' https://*.freighter.app chrome-extension: moz-extension:
object-src 'none'
base-uri 'self'
form-action 'self'
frame-ancestors 'none'
report-to csp-endpoint
report-uri /api/csp-report
```

Notes:

- **No `'unsafe-inline'` in `script-src`.** `'strict-dynamic'` lets
  nonce-trusted scripts load their own chunks. Development adds
  `'unsafe-eval'` for HMR/Fast Refresh; production does not.
- **`'wasm-unsafe-eval'`** is required for the Stellar/Soroban WASM client.
- **`style-src 'unsafe-inline'`** is retained for the CSS-in-JS/Tailwind
  runtime. It does not permit script execution.
- **`connect-src`** is the only place wallet/RPC network origins belong. Add
  new Horizon, Soroban RPC, or wallet endpoints there — never widen
  `default-src`, and never add `*`.
- **`frame-src`** permits the Freighter wallet extension origins. If another
  wallet connector needs an iframe, add its exact origin (not a wildcard
  unless the vendor requires a subdomain wildcard such as
  `https://*.freighter.app`).
- **`frame-ancestors 'none'`** duplicates `X-Frame-Options: DENY` for modern
  browsers.
- **API responses do not carry a CSP.** A CSP on JSON is inert; the baseline
  headers above still apply.

CSP violations are POSTed to `/api/csp-report`, which enforces a 16 KiB body
cap, a per-IP rate limit, deduplication, and Prometheus counters. See
[SECURITY_HEADERS.md](SECURITY_HEADERS.md#csp-report-collector-protections-1392).

## Nonces and hashes

Nonces are the default for dynamic scripts and are required for the App
Router's inline hydration/streaming scripts. A CSP **hash** is only appropriate
for a fixed inline script whose bytes never change; add the hash to
`script-src` alongside the nonce only if such a script cannot accept the
nonce. Never add `'unsafe-inline'` as a workaround — it defeats both mechanisms
in CSP Level 3 browsers.

## Maintaining the policy

1. **Change an origin or directive** in `src/lib/proxy-config.ts`
   (`CSP_POLICY` / `buildCsp`), not inline in `src/proxy.ts`.
2. **Run the focused tests**:

   ```bash
   npx vitest run \
     tests/middleware/security-headers.test.ts \
     src/__tests__/security-headers.test.ts \
     src/__tests__/proxy-config.test.ts
   ```

   The middleware suite asserts header presence on `/`, `/payments`,
   `/webhooks`, `/api/webhooks`, `/api/webhooks/:id`, `/api/health`, plus a
   proxy-generated 401. The config suites pin static-header ownership and the
   no-`unsafe-inline` rule.

3. **Update this file and `SECURITY_HEADERS.md`** in the same change. A policy
   change without documentation is a review-blocking omission.
4. **Verify a real response** (CDNs and reverse proxies can add headers):

   ```bash
   curl -sSI https://your-host.example/ | grep -iE 'content-security-policy|x-frame-options|permissions-policy|strict-transport-security'
   curl -sSI https://your-host.example/api/health | grep -iE 'x-content-type-options|x-frame-options|referrer-policy'
   ```

5. **Never weaken a header to fix a local symptom.** If a new dependency needs
   an origin, add that origin; if a script needs execution, give it the nonce.

## Related documentation

- [SECURITY_HEADERS.md](SECURITY_HEADERS.md) — effective per-layer policy and
  deployment verification.
- [`SECURITY.md`](../SECURITY.md) — vulnerability disclosure policy.
- [`src/lib/proxy-config.ts`](../src/lib/proxy-config.ts) — the policy source.
