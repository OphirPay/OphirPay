/**
 * Security policy constants and helpers.
 *
 * This module centralises all security‑related configuration that was previously
 * scattered in `src/proxy.ts`.  The CSP directives are expressed as a plain
 * object where each key is a directive name and the value is an array of
 * directive values.  This makes it easy to audit, test and modify the policy
 * without having to parse a template string.
 *
 * The rate‑limit configuration and client‑IP header precedence are also
 * exported here so that the proxy middleware can use them without
 * duplicating literals.
 */

export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100; // per window

/**
 * Order of headers to determine the client IP address.  The first header
 * that contains a valid IP will be used.
 */
export const CLIENT_IP_HEADER_ORDER = [
  'x-forwarded-for',
  'x-real-ip',
  'remoteAddress',
] as const;

/**
 * CSP directives expressed as structured data.
 *
 * The values are intentionally kept as strings so that they can be
 * concatenated into a header value later.  The `nonce` placeholder is
 * replaced at runtime by the proxy middleware.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  // Default policy
  "default-src": ["'self'"],

  // Scripts
  "script-src": ["'self'", "'nonce-<nonce>'"],

  // Styles
  "style-src": ["'self'", "'unsafe-inline'"],

  // Images
  "img-src": ["'self'", "data:"],

  // Connects (e.g. Horizon, RPC)
  "connect-src": [
    "'self'",
    "https://horizon.stellar.org",
    "https://horizon-testnet.stellar.org",
    "https://rpc.stellar.org",
    "https://rpc-testnet.stellar.org",
    "https://rpc-futurenet.stellar.org",
  ],

  // Fonts
  "font-src": ["'self'"],

  // No plugins
  "object-src": ["'none'"],

  // No frames
  "frame-ancestors": ["'none'"],

  // Base URI
  "base-uri": ["'self'"],

  // Form actions
  "form-action": ["'self'"],
};

/**
 * Helper to build a CSP header string from the `CSP_DIRECTIVES` object.
 *
 * @param nonce Optional nonce value to replace the `<nonce>` placeholder.
 * @returns The CSP header value.
 */
export function buildCSPHeader(nonce?: string): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, values]) => {
      const replaced = values.map((v) =>
        v === "'nonce-<nonce>'" && nonce ? `'nonce-${nonce}'` : v
      );
      return `${directive} ${replaced.join(' ')}`;
    })
    .join('; ');
}
