# Security Header Policy

This document describes the headers configured in this repository and where
they are applied. It reflects the current checked-in configuration; deployment
platform settings outside the repository can add or override response headers.

## Configuration ownership

| Layer                         | Responsibility                                                                                                                            | Applies to                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/lib/security-headers.ts` | Baseline security header values shared by the app layer.                                                                                  | Imported by `next.config.ts` and `src/proxy.ts`.         |
| `next.config.ts` `headers()`  | Static security headers and cache policy. This is the shared source for Vercel and self-hosted Next.js deployments.                       | All paths, with specific API and static-asset overrides. |
| `src/proxy.ts`                | Per-request CSP and CSP reporting on page requests; request, rate-limit, CORS, and a matching subset of security headers on API requests. | Matched page and `/api/*` requests.                      |
| `vercel.json`                 | Next.js build/deployment settings and the `/home` redirect. It currently defines **no security headers**.                                 | Vercel routing/deployment only.                          |

`next.config.ts` applies the static headers on both Vercel and self-hosted
Next.js targets. The proxy's page response supplies the dynamic CSP. The
overlapping `X-Content-Type-Options`, `X-Frame-Options`, and
`Referrer-Policy` values set by the proxy match the static values; neither
layer intentionally weakens the other. `vercel.json` does not add a competing
`X-XSS-Protection` value in the current tree.

For API requests, the static `/api/(.*)` rule changes
`Cross-Origin-Resource-Policy` from the global `same-origin` value to
`cross-origin` and sets `Cache-Control: no-cache, no-store, must-revalidate`.
The proxy adds CORS only for the configured application origin in production
(or permissively in non-production); it does not attach the page CSP to API
responses. If a deployment's Vercel project settings, CDN, reverse proxy, or
load balancer add their own headers, inspect the deployed response because
those external layers are outside this repository's precedence.

## Effective repository policy

| Header                                                                     | Page responses                     | API responses        | Source / intent                                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options: nosniff`                                          | Yes                                | Yes                  | Prevent MIME-type sniffing.                                                                                      |
| `X-Frame-Options: DENY`                                                    | Yes                                | Yes                  | Block framing to reduce clickjacking risk.                                                                       |
| `X-XSS-Protection: 0`                                                      | Yes                                | Static policy        | Disable the deprecated browser XSS filter; do not restore `1; mode=block`.                                       |
| `Referrer-Policy: strict-origin-when-cross-origin`                         | Yes                                | Yes                  | Limit referrer detail on cross-origin navigation.                                                                |
| `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` | Yes                                | Static policy        | Disable browser capabilities OphirPay does not use.                                                              |
| `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`  | Yes                                | Static policy        | Require HTTPS in browsers after a secure response. Browsers ignore HSTS over ordinary local HTTP.                |
| `Cross-Origin-Opener-Policy: same-origin`                                  | Yes                                | Static policy        | Isolate top-level browsing contexts.                                                                             |
| `Cross-Origin-Resource-Policy`                                             | `same-origin`                      | `cross-origin`       | Allow API responses to be read under the API's CORS policy; static API-specific rule overrides the global value. |
| `Content-Security-Policy`                                                  | Per-request policy below           | Not set by the proxy | Restrict scripts, styles, connections, frames, objects, and form destinations; see [SECURITY.md](SECURITY.md).   |
| `Report-To` / `Reporting-Endpoints`                                        | CSP collector at `/api/csp-report` | Not set by the proxy | Direct supported browsers to the CSP reporting endpoint.                                                         |

The static cache rules are also in `next.config.ts`: content-addressed
`/_next/static/*` assets are immutable for one year, and `/_next/image` uses a
one-hour cache plus stale-while-revalidate. API responses are not cached.

## Content Security Policy

`src/proxy.ts` constructs CSP for matched non-API page requests. The common
directives are:

```text
default-src 'self'
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

The script policy varies by runtime:

| Runtime                    | `script-src`                                                                     |
| -------------------------- | -------------------------------------------------------------------------------- |
| Production                 | `'self' 'nonce-<per-request>' 'strict-dynamic' 'wasm-unsafe-eval'`               |
| Development/non-production | `'self' 'nonce-<per-request>' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'` |

`'unsafe-inline'` is deliberately absent from `script-src` (issue #1257): the
proxy mints a fresh nonce per HTML request and puts the CSP on the request
headers so the App Router renderer can stamp it on framework scripts, while
`'strict-dynamic'` covers chunks those scripts load. Development additionally
needs `'unsafe-eval'` for HMR/Fast Refresh. A CSP hash is only appropriate for
a fixed inline script that cannot accept the nonce; see [SECURITY.md](SECURITY.md)
for the maintenance workflow and the middleware test that enforces this.

The page CSP reports to `POST /api/csp-report`; the collector validates and
limits reports before logging them. See `src/proxy.ts` and
[AUDIT.md](AUDIT.md) for the implementation and tracked limitation.

### CSP Report Collector Protections (#1392)

To prevent denial-of-service floods, disk exhaustion, and inflated logging costs from synthetic or bursty violation reports, `POST /api/csp-report` enforces strict controls:

- **Body Size Cap**: Request bodies are capped at 16 KiB (`MAX_BODY_BYTES = 16 * 1024`). Oversized requests are immediately rejected with `413 Payload Too Large` and counted under `csp_reports_dropped_total{reason="oversized"}`.
- **Rate Limiting**: Enforces a sliding-window rate limit of **60 reports per minute** per client IP and session. Requests exceeding the quota receive `429 Too Many Requests` with a `Retry-After` header and are counted under `csp_reports_dropped_total{reason="rate_limited"}`.
- **Payload Deduplication**: Reports sharing identical `violated-directive` (or `effective-directive`) and `blocked-uri` within a **5-minute sliding window** are suppressed from warning logs. Suppressed duplicates are tracked under `csp_reports_dropped_total{reason="deduplicated"}`.
- **Metrics Observability**: Accepted reports increment `ophirpay_csp_violation_reports_total`, while dropped or throttled reports increment `ophirpay_csp_reports_dropped_total{reason="..."}` in Prometheus exposition.

### Theme Bootstrap Blocking Script & CSP Nonce (#1376)

To eliminate Flash of Unstyled Content (FOUC) and theme flicker before client-side hydration, an inline pre-paint script (`THEME_BLOCKING_SCRIPT` in `src/app/layout.tsx`) executes synchronously in `<head>`.
The script inspects `localStorage.getItem("theme")` and `localStorage.getItem("ophirpay-theme")` with fallback to `prefers-color-scheme: dark`, setting `.dark`, `data-theme`, and `colorScheme` on `document.documentElement` before the first paint.
To comply with Content Security Policy (`script-src`), `src/proxy.ts` generates a per-request cryptographically unguessable nonce via the `x-nonce` request header, which `src/app/layout.tsx` stamps directly onto `<script id="theme-blocking-script" nonce={nonce}>`.

## Checking a deployment

Inspect both an HTML page and an API response at each deployment boundary; a
local Next.js response does not reveal headers injected by a CDN or platform:

```bash
curl -sSI https://your-host.example/
curl -sSI https://your-host.example/api/health
```

Confirm that page responses carry CSP and the page policy, API responses do
not accidentally inherit a CSP restriction intended for browser pages, API
CORP is `cross-origin`, and `X-XSS-Protection` is `0`. Also verify HSTS and
cache values over the actual production route.
