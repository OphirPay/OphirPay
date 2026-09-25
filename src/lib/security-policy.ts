// SPDX-License-Identifier: MIT

/**
 * Security policy constants and CSP configuration for OphirPay middleware/proxy.
 *
 * Centralizes:
 * - CSP directives structured as data for straightforward auditing
 * - Approved Stellar Horizon and Soroban RPC endpoint whitelists
 * - Rate limiting defaults and skip paths
 * - Client IP header evaluation precedence
 * - Baseline security and CORS response headers
 */

export const STELLAR_HORIZON_ENDPOINTS = [
  "https://horizon-testnet.stellar.org",
  "https://horizon.stellar.org",
] as const;

export const STELLAR_SOROBAN_RPC_ENDPOINTS = [
  "https://soroban-testnet.stellar.org",
  "https://soroban.stellar.org",
  "https://rpc-futurenet.stellar.org",
  "https://mainnet.soroban.rpc.pulse.so",
] as const;

export const STELLAR_EXPLORER_AND_ASSET_HOSTS = [
  "https://stellar.expert",
  "https://raw.githubusercontent.com",
] as const;

export const WALLET_FRAME_SOURCES = [
  "https://*.freighter.app",
  "chrome-extension:",
  "moz-extension:",
] as const;

/**
 * Production CSP directives expressed as structured data (one entry per directive).
 */
export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "connect-src": [
    "'self'",
    ...STELLAR_HORIZON_ENDPOINTS,
    ...STELLAR_SOROBAN_RPC_ENDPOINTS,
  ],
  "img-src": [
    "'self'",
    "data:",
    ...STELLAR_EXPLORER_AND_ASSET_HOSTS,
  ],
  "font-src": ["'self'"],
  "frame-src": [
    "'self'",
    ...WALLET_FRAME_SOURCES,
  ],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
} as const;

/**
 * Additional script-src relaxations permitted only in development mode.
 */
export const CSP_DEV_SCRIPT_RELAXATIONS = ["'unsafe-eval'"] as const;

/**
 * Format a dictionary of CSP directives into a valid Content-Security-Policy header string.
 */
export function formatCsp(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Build Content-Security-Policy header string for HTML pages.
 */
export function buildCsp(production = process.env.NODE_ENV === "production"): string {
  const directives: Record<string, string[]> = {};

  for (const [name, sources] of Object.entries(CSP_DIRECTIVES)) {
    directives[name] = [...sources];
  }

  if (!production) {
    directives["script-src"].push(...CSP_DEV_SCRIPT_RELAXATIONS);
  }

  return formatCsp(directives);
}

/** Default rate limiting window: 1 minute */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Default requests per minute per IP */
export const DEFAULT_RATE_LIMIT_RPM = 120;

export function getRateLimitMax(envValue = process.env.RATE_LIMIT_RPM): number {
  return Math.max(
    1,
    parseInt(envValue || String(DEFAULT_RATE_LIMIT_RPM), 10) || DEFAULT_RATE_LIMIT_RPM
  );
}

/** Paths excluded from rate limiting (e.g. monitoring endpoints hit by orchestrators) */
export const SKIP_RATE_LIMIT_PATHS = [
  "/api/health",
  "/api/metrics",
] as const;

/** Precedence order for evaluating client IP from request headers */
export const CLIENT_IP_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
] as const;

export function resolveClientIp(
  getHeader: (header: string) => string | null | undefined
): string {
  for (const header of CLIENT_IP_HEADERS) {
    const val = getHeader(header);
    if (val) {
      if (header === "x-forwarded-for") {
        const first = val.split(",")[0]?.trim();
        if (first) return first;
      } else {
        const trimmed = val.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return "unknown";
}

/**
 * Generate a unique request ID for tracing and logging.
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Static baseline security headers applied to responses.
 */
export const SECURITY_HEADERS = {
  "X-Api-Version": "1.0.0",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
} as const;

/**
 * CORS policy configuration.
 */
export const CORS_CONFIG = {
  allowMethods: "GET, POST, PUT, DELETE, OPTIONS",
  allowHeaders: "Content-Type, Authorization, X-API-Key",
  defaultOrigin: "http://localhost:3000",
} as const;
