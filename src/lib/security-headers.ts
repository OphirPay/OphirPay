// SPDX-License-Identifier: MIT

import crypto from "crypto";
import { CSP_POLICY, buildCsp, generateNonce } from "@/lib/proxy-config";

/**
 * Approved Stellar Horizon and Soroban RPC origins allowed in `connect-src` (#1310).
 */
export const STELLAR_CONNECT_ORIGINS: readonly string[] = CSP_POLICY.connectSrc;

/**
 * Approved Stellar wallet connector frame origins allowed in `frame-src` (#1310).
 */
export const WALLET_FRAME_ORIGINS: readonly string[] = CSP_POLICY.frameSrc;

/**
 * Strict static security headers applied across document and API responses (#1310).
 */
export const STRICT_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-DNS-Prefetch-Control": "on",
});

export interface BuildSecurityHeadersOptions {
  /** Per-request cryptographic nonce for dynamic script execution. */
  nonce?: string;
  /** Optional SHA-256 script hashes (e.g., `sha256-abc...`) allowed in `script-src`. */
  scriptHashes?: string[];
  /** Whether to build production CSP (disables `'unsafe-eval'`). Defaults to NODE_ENV === "production". */
  isProduction?: boolean;
  /** Route pathname used to tailor API vs document CSP headers. */
  pathname?: string;
}

/**
 * Generate a fresh 128-bit base64 nonce for CSP `script-src` (#1310).
 */
export function generateCspNonce(): string {
  return generateNonce();
}

/**
 * Compute a CSP-formatted `'sha256-<base64>'` hash for a dynamic script snippet.
 */
export function computeScriptSha256Hash(scriptContent: string): string {
  const digest = crypto.createHash("sha256").update(scriptContent, "utf8").digest("base64");
  return `sha256-${digest}`;
}

/**
 * Verify that a script's SHA-256 hash matches an expected CSP hash token (`sha256-<base64>`).
 */
export function verifyScriptHash(scriptContent: string, expectedHash: string): boolean {
  const normalizedExpected = expectedHash.replace(/^'|'$/g, "");
  const computed = computeScriptSha256Hash(scriptContent);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(normalizedExpected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Build the strict Content-Security-Policy header value for web documents or API routes (#1310).
 */
export function buildStrictCspHeader(options: BuildSecurityHeadersOptions = {}): string {
  const {
    nonce = generateCspNonce(),
    scriptHashes = [],
    isProduction = process.env.NODE_ENV === "production",
    pathname = "/",
  } = options;

  // API and webhook routes return JSON/SSE and should never execute scripts or embed frames.
  if (pathname.startsWith("/api/")) {
    return [
      "default-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
  }

  let baseCsp = buildCsp(nonce, isProduction);
  if (scriptHashes.length > 0) {
    const formattedHashes = scriptHashes
      .map((h) => {
        const clean = h.replace(/^'|'$/g, "");
        return `'${clean}'`;
      })
      .join(" ");
    baseCsp = baseCsp.replace(
      `'nonce-${nonce}'`,
      `'nonce-${nonce}' ${formattedHashes}`,
    );
  }

  if (!baseCsp.includes("frame-ancestors")) {
    baseCsp = `${baseCsp}; frame-ancestors 'none'`;
  }

  return baseCsp;
}

/**
 * Return the full strict security header map for a given request context (#1310).
 */
export function getStrictSecurityHeaders(
  options: BuildSecurityHeadersOptions = {},
): Record<string, string> {
  const nonce = options.nonce ?? generateCspNonce();
  const csp = buildStrictCspHeader({ ...options, nonce });

  const headers: Record<string, string> = {
    ...STRICT_SECURITY_HEADERS,
    "Content-Security-Policy": csp,
  };

  if (!options.pathname?.startsWith("/api/")) {
    headers["x-nonce"] = nonce;
  }

  return headers;
}

/**
 * Apply strict security and CSP headers to a Fetch/Next `Response` or `Headers` instance.
 */
export function applySecurityHeaders<T extends { headers: Pick<Headers, "set"> }>(
  target: T,
  options: BuildSecurityHeadersOptions = {},
): T {
  const secHeaders = getStrictSecurityHeaders(options);
  for (const [key, value] of Object.entries(secHeaders)) {
    target.headers.set(key, value);
  }
  return target;
}
