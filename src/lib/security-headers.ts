// SPDX-License-Identifier: MIT

/**
 * Baseline security headers applied to every document and API response.
 *
 * These values are the single source of truth for both layers that can set
 * them:
 *
 *   - `next.config.ts` emits them statically for every route (Vercel and
 *     self-hosted Next.js).
 *   - `src/proxy.ts` re-applies them per request, so a response produced by the
 *     proxy (including early 401/403/429 JSON responses) can never omit them.
 *
 * `Content-Security-Policy` is intentionally not here: it needs a per-request
 * nonce and is built in `src/lib/proxy-config.ts`.
 *
 * `Cross-Origin-Resource-Policy` is also not here because its correct value is
 * path-dependent (`same-origin` for pages/assets, `cross-origin` for the API).
 */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // The legacy IE/old-Chrome XSS filter is deprecated and has itself been
  // abused for cross-site scripting, so it is explicitly disabled.
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
} as const;

export type SecurityHeaderName = keyof typeof SECURITY_HEADERS;

/** Apply the baseline security headers to a response's header bag. */
export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
}
