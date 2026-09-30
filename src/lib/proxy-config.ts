// SPDX-License-Identifier: MIT

export const RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_RPM = 120;

export function getRateLimitMax(value = process.env.RATE_LIMIT_RPM): number {
  return Math.max(1, parseInt(value || String(DEFAULT_RATE_LIMIT_RPM), 10) || DEFAULT_RATE_LIMIT_RPM);
}

export function getClientIp(headers: Pick<Headers, "get">): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

export function generateRequestId(
  now = Date.now(),
  random = Math.random()
): string {
  return `req_${now.toString(36)}_${random.toString(36).slice(2, 8)}`;
}

export const CSP_POLICY = {
  defaultSrc: ["'self'"],
  // `'unsafe-inline'` is deliberately absent (issue #1257, follow-up to #697):
  // every HTML request carries a fresh nonce instead, and `'strict-dynamic'`
  // lets nonce-trusted scripts load their own chunks. Development additionally
  // needs `'unsafe-eval'` for HMR / Fast Refresh.
  scriptSrc: {
    production: ["'self'", "'strict-dynamic'", "'wasm-unsafe-eval'"],
    development: ["'self'", "'strict-dynamic'", "'unsafe-eval'", "'wasm-unsafe-eval'"],
  },
  styleSrc: ["'self'", "'unsafe-inline'"],
  connectSrc: [
    "'self'",
    "https://horizon-testnet.stellar.org",
    "https://horizon.stellar.org",
    "https://soroban-testnet.stellar.org",
    "https://soroban.stellar.org",
    "https://rpc-futurenet.stellar.org",
    "https://mainnet.soroban.rpc.pulse.so",
  ],
  imgSrc: [
    "'self'",
    "data:",
    "https://stellar.expert",
    "https://raw.githubusercontent.com",
  ],
  fontSrc: ["'self'"],
  frameSrc: ["'self'", "https://*.freighter.app", "chrome-extension:", "moz-extension:"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  reportingGroup: "csp-endpoint",
  reportUri: "/api/csp-report",
} as const;

/**
 * Fresh, unguessable nonce for each HTML request (128 bits, base64).
 *
 * The nonce is generated per request so it cannot be reused across documents,
 * and it must be applied to the *request* headers handed to the App Router
 * renderer (see src/proxy.ts) — setting it on the response alone never reaches
 * `getScriptNonceFromHeader` and is what left `#697` unresolved.
 */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * Content-Security-Policy for HTML pages.
 *
 * `script-src` is assembled per request from `nonce` plus the environment
 * template, so `'unsafe-inline'` is never emitted. The remaining directives
 * (including the #698 violation-reporting pair) stay environment-static and
 * reviewable in `CSP_POLICY`.
 */
export function buildCsp(
  nonce: string,
  isProduction = process.env.NODE_ENV === "production"
): string {
  const template = isProduction
    ? CSP_POLICY.scriptSrc.production
    : CSP_POLICY.scriptSrc.development;
  // Slot the nonce directly after 'self' so the directive always reads
  // `'self' 'nonce-…' 'strict-dynamic' …`.
  const scriptSrc = [template[0], `'nonce-${nonce}'`, ...template.slice(1)];
  const directives: Array<[string, readonly string[]]> = [
    ["default-src", CSP_POLICY.defaultSrc],
    ["script-src", scriptSrc],
    ["style-src", CSP_POLICY.styleSrc],
    ["connect-src", CSP_POLICY.connectSrc],
    ["img-src", CSP_POLICY.imgSrc],
    ["font-src", CSP_POLICY.fontSrc],
    ["frame-src", CSP_POLICY.frameSrc],
    ["object-src", CSP_POLICY.objectSrc],
    ["base-uri", CSP_POLICY.baseUri],
    ["form-action", CSP_POLICY.formAction],
    ["report-to", [CSP_POLICY.reportingGroup]],
    ["report-uri", [CSP_POLICY.reportUri]],
  ];

  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}
