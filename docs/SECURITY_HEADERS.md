# Security Header Policy

This document lists every security‑relevant HTTP header that the OphirPay
application emits, the value that is intended for each deployment stage,
the file that sets the header, and the rationale behind the chosen value.
It is the single source of truth for the security header policy and
should be consulted whenever a change to a header is considered.

| Header | Intended Value | Authoritative Source | Deployment Layer | Rationale |
|--------|----------------|----------------------|------------------|-----------|
| **X‑Content‑Type‑Options** | `nosniff` | `next.config.ts` | All | Prevent browsers from MIME‑sniffing responses. |
| **X‑Frame‑Options** | `DENY` | `next.config.ts` | All | Disallow framing of the site to mitigate click‑jacking. |
| **X‑XSS‑Protection** | `1; mode=block` | `next.config.ts` | All | Enable legacy XSS filter in browsers that still support it. |
| **Referrer‑Policy** | `strict-origin-when-cross-origin` | `next.config.ts` | All | Limit referrer leakage while still allowing same‑origin referrers. |
| **Permissions‑Policy** | `geolocation=(), microphone=(), camera=()` | `next.config.ts` | All | Explicitly disable potentially privacy‑sensitive APIs. |
| **Strict‑Transport‑Security** | `max-age=31536000; includeSubDomains; preload` | `next.config.ts` | Production | Enforce HTTPS for one year and preload the site. |
| **Cross‑Origin‑Opener‑Policy** | `same-origin` | `next.config.ts` | Production | Prevent cross‑origin window navigation. |
| **Cross‑Origin‑Resource‑Policy** | `same-origin` | `next.config.ts` | Production | Restrict cross‑origin resource loading. |
| **Content‑Security‑Policy** | <br>`default-src 'self';`<br>`script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;`<br>`style-src 'self' 'unsafe-inline';`<br>`img-src 'self' data:;`<br>`connect-src 'self' https://api.stellar.org;` | `src/proxy.ts` | All | The CSP is generated per request. In production the `unsafe-inline` keyword is retained to allow inline scripts that are required for the dashboard’s dynamic widgets. This relaxation is documented in issue #781. In development the CSP is relaxed further to allow local tooling. |
| **Vercel Static Asset Cache** | `Cache-Control: public, max-age=31536000, immutable` | `vercel.json` | All | Set a long‑lived cache for static assets. |

> **Note**: The `vercel.json` file contains a subset of the headers defined in
> `next.config.ts` because Vercel’s edge configuration overrides the
> Next.js runtime configuration for static assets. The values in
> `vercel.json` are intentionally identical to those in `next.config.ts`
> except for `X‑XSS‑Protection`, which is set to `0` in Vercel to avoid
> double‑setting the header. The final header sent to the browser is the
> one from the runtime (Next.js) because Vercel’s edge configuration
> only applies to static files.

## Deliberate Relaxations

| Header | Relaxation | Reason | Tracking Issue |
|--------|------------|--------|----------------|
| **Content‑Security‑Policy** | `unsafe-inline` in `script-src` and `style-src` | Required for inline scripts/styles used by the dashboard’s analytics and widget system. | #781 |
| **X‑XSS‑Protection** | `0` in `vercel.json` | Vercel’s edge configuration cannot set this header for static assets; the runtime header is used instead. | #781 |

---

For any changes to these headers, please update this document first and
ensure that the corresponding source file(s) reflect the new values.
