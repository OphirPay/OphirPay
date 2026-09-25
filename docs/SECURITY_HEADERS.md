# Security header policy

This document is the source-of-truth map for the security-relevant HTTP headers emitted by OphirPay.
It explains which layer owns each header, where the value is set, and why deliberate relaxations exist.

## Ownership model

| Layer | File | Scope | Responsibility |
|---|---|---|---|
| Next.js static headers | [`next.config.ts`](../next.config.ts) | All routes plus route-specific cache rules | Baseline security headers and cache policy shared by Vercel and self-hosted deployments. |
| Runtime proxy | [`src/proxy.ts`](../src/proxy.ts) | API routes and HTML page requests matched by the proxy | Request IDs, API rate-limit headers, CORS, API metadata, and per-request CSP for HTML pages. |
| Vercel routing/build config | [`vercel.json`](../vercel.json) | Vercel deployment metadata | Build/install/region/redirect settings only. It intentionally does **not** set headers, so Vercel cannot drift from self-hosted deployments. |

`next.config.ts` is authoritative for static security headers. `src/proxy.ts` may repeat selected headers for proxied responses so API and HTML responses still carry the policy after middleware processing. `vercel.json` must not duplicate security headers.

## Effective headers

| Header | Intended value | Authoritative source | Applies to | Rationale |
|---|---|---|---|---|
| `Content-Security-Policy` | Built by `buildCsp()`; production uses `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'` plus Stellar Horizon/Soroban RPC endpoints; image/font/frame/object/base/form restrictions. Development adds `'unsafe-eval'`. | [`src/proxy.ts`](../src/proxy.ts) | HTML page responses matched by the proxy | CSP must vary by environment. The project keeps `script-src 'unsafe-inline'` because the current Next.js App Router renderer does not receive a per-request nonce; removing it blocks streaming/hydration scripts. Tracking context: issue #781. |
| `X-Content-Type-Options` | `nosniff` | [`next.config.ts`](../next.config.ts); repeated for proxied API/HTML responses in [`src/proxy.ts`](../src/proxy.ts) | All app responses, API responses, HTML responses | Prevents MIME sniffing and reduces script/style confusion attacks. |
| `X-Frame-Options` | `DENY` | [`next.config.ts`](../next.config.ts); repeated for proxied API/HTML responses in [`src/proxy.ts`](../src/proxy.ts) | All app responses, API responses, HTML responses | Prevents clickjacking by disallowing framing of OphirPay pages. |
| `X-XSS-Protection` | `0` | [`next.config.ts`](../next.config.ts) | All responses covered by Next.js static headers | Disables deprecated browser XSS filters that can introduce vulnerabilities or inconsistent behavior. Do not restore `1; mode=block`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | [`next.config.ts`](../next.config.ts); repeated for proxied API/HTML responses in [`src/proxy.ts`](../src/proxy.ts) | All app responses, API responses, HTML responses | Sends full referrer only same-origin, origin-only cross-origin over HTTPS, and nothing on downgrades. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | [`next.config.ts`](../next.config.ts) | All responses covered by Next.js static headers | Denies browser capabilities the app does not need. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | [`next.config.ts`](../next.config.ts) | HTTPS production responses | Enforces HTTPS for the domain and subdomains after first secure visit. Only enable on domains that are permanently HTTPS-ready. |
| `Cross-Origin-Opener-Policy` | `same-origin` | [`next.config.ts`](../next.config.ts) | All responses covered by Next.js static headers | Isolates browsing contexts to reduce cross-origin opener attacks. |
| `Cross-Origin-Resource-Policy` | `same-origin` globally; `/api/(.*)` overrides to `cross-origin` in `next.config.ts`. | [`next.config.ts`](../next.config.ts) | Global app responses and API route responses | Keeps app resources same-origin by default while allowing API responses to be consumed where explicitly permitted by CORS/proxy policy. |
| `Cache-Control` | `public, max-age=31536000, immutable` for `/_next/static/(.*)`; `public, max-age=3600, stale-while-revalidate=86400` for `/_next/image`; `no-cache, no-store, must-revalidate` for `/api/(.*)`. | [`next.config.ts`](../next.config.ts) | Static chunks, optimized images, API routes | Content-addressed assets can be immutable; optimized images need shorter freshness; APIs must not be cached by shared intermediaries. |
| `X-Request-Id` | Generated `req_<time>_<random>` | [`src/proxy.ts`](../src/proxy.ts) | API and HTML responses matched by the proxy | Correlates logs, route handlers, and client-visible failures. |
| `X-Api-Version` | `1.0.0` | [`src/proxy.ts`](../src/proxy.ts) | API and HTML responses matched by the proxy | Exposes the runtime API contract version. |
| `X-RateLimit-Limit` | Current `RATE_LIMIT_RPM` value, default `120` | [`src/proxy.ts`](../src/proxy.ts) | API responses except health/metrics bypass behavior | Documents the active per-IP request limit for clients. |
| `X-RateLimit-Remaining` | Remaining requests in the current window | [`src/proxy.ts`](../src/proxy.ts) | API responses except health/metrics bypass behavior | Lets API consumers back off before receiving `429`. |
| `X-RateLimit-Reset` | Unix timestamp for the next rate-limit window | [`src/proxy.ts`](../src/proxy.ts) | API responses except health/metrics bypass behavior | Lets API consumers schedule retries. |
| `Retry-After` | Seconds until reset | [`src/proxy.ts`](../src/proxy.ts) | API `429` responses | Standard retry hint for rate-limited clients. |
| `Access-Control-Allow-Origin` | Production: `NEXT_PUBLIC_APP_URL` when it matches the request `Origin`; non-production: request origin or `*`. | [`src/proxy.ts`](../src/proxy.ts) | API responses | Restricts browser API reads in production while keeping local development usable. |
| `Access-Control-Allow-Methods` | `GET, POST, PUT, DELETE, OPTIONS` | [`src/proxy.ts`](../src/proxy.ts) | API responses | Declares supported CORS methods. |
| `Access-Control-Allow-Headers` | `Content-Type, Authorization, X-API-Key` | [`src/proxy.ts`](../src/proxy.ts) | API responses | Allows authenticated API clients to send the required headers. |

## Deliberate relaxations

| Relaxation | Where | Why | Tracking |
|---|---|---|---|
| `script-src 'unsafe-inline'` in production CSP | [`src/proxy.ts`](../src/proxy.ts) | Next.js App Router streaming/hydration currently needs inline scripts and the proxy nonce does not reach the renderer. Removing this breaks hydration. | Issue #781 documents the policy; remove only after nonce propagation is implemented and tested. |
| `script-src 'unsafe-eval'` in development CSP only | [`src/proxy.ts`](../src/proxy.ts) | Required for HMR/Fast Refresh in local development. Not present in production. | Issue #781. |
| `style-src 'unsafe-inline'` | [`src/proxy.ts`](../src/proxy.ts) | Tailwind/Next runtime style injection and component inline styles need it until styles are fully extracted/nonced. | Issue #781. |
| `Cross-Origin-Resource-Policy: cross-origin` on `/api/(.*)` | [`next.config.ts`](../next.config.ts) | API consumers may be cross-origin when CORS allows them; app pages and assets stay same-origin by default. | Issue #781. |
| API rate-limit bypass for `/api/health` and `/api/metrics` | [`src/proxy.ts`](../src/proxy.ts) | Orchestrators and Prometheus scrape these frequently and should not be throttled. | Issue #781. |

## Vercel behavior

`vercel.json` must remain free of `headers`. Header duplication there previously risked deployment-specific drift. If a future Vercel setting needs a header that cannot be expressed in `next.config.ts`, add it here first with:

1. the exact file/layer that owns it,
2. the value in Vercel and self-hosted deployments,
3. a test proving the two deployments cannot diverge silently.

## Reviewer checklist

When changing any security header:

- Update this document in the same PR.
- Keep `vercel.json` free of header declarations unless there is a documented exception.
- Explain any CSP relaxation and whether it applies to production, development, or both.
- Confirm API cache headers still prevent shared/intermediary caching.
- Confirm health and metrics behavior is intentional if rate-limit headers change.
