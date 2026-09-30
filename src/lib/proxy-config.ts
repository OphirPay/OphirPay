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
  scriptSrc: {
    production: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
    development: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"],
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
 * Next.js App Router still emits inline hydration scripts that do not receive
 * proxy nonces reliably. Keep 'unsafe-inline' until nonce propagation works
 * end-to-end; development also needs 'unsafe-eval' for HMR / Fast Refresh.
 */
export function buildCsp(isProduction = process.env.NODE_ENV === "production"): string {
  const scriptSrc = isProduction
    ? CSP_POLICY.scriptSrc.production
    : CSP_POLICY.scriptSrc.development;
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
