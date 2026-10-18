// SPDX-License-Identifier: MIT

import { buildCsp, generateNonce, CSP_POLICY } from "@/lib/proxy-config";

/**
 * Standard HTTP security headers applied across all responses.
 */
export const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "X-DNS-Prefetch-Control": "off",
  "X-Download-Options": "noopen",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export const HSTS_HEADER = "max-age=63072000; includeSubDomains; preload";

export interface SecurityHeadersOptions {
  nonce?: string;
  isApi?: boolean;
  isProduction?: boolean;
}

/**
 * Get all security headers as a plain record or Headers object.
 */
export function getSecurityHeaders(options: SecurityHeadersOptions = {}): Record<string, string> {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const headers: Record<string, string> = { ...DEFAULT_SECURITY_HEADERS };

  if (isProduction) {
    headers["Strict-Transport-Security"] = HSTS_HEADER;
  }

  if (!options.isApi) {
    const nonce = options.nonce || generateNonce();
    headers["Content-Security-Policy"] = buildCsp(nonce, isProduction);
    headers["x-nonce"] = nonce;

    // Reporting API
    headers["Report-To"] = JSON.stringify({
      group: CSP_POLICY.reportingGroup,
      max_age: 10886400,
      endpoints: [{ url: CSP_POLICY.reportUri }],
      include_subdomains: false,
    });
    headers["Reporting-Endpoints"] = `${CSP_POLICY.reportingGroup}="${CSP_POLICY.reportUri}"`;
  }

  return headers;
}

/**
 * Apply security headers onto an existing Headers or Response object.
 */
export function applySecurityHeaders(
  target: Headers | { headers: Headers },
  options: SecurityHeadersOptions = {}
): void {
  const headersObj = "headers" in target && target.headers instanceof Headers
    ? target.headers
    : (target as Headers);

  const secHeaders = getSecurityHeaders(options);
  for (const [key, value] of Object.entries(secHeaders)) {
    headersObj.set(key, value);
  }
}

export { buildCsp, generateNonce, CSP_POLICY };
