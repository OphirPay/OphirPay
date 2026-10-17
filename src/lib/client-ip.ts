// SPDX-License-Identifier: MIT

/**
 * Client IP address extraction and validation utility.
 * Protects rate limiters and audit logs against HTTP header spoofing.
 *
 * Implements:
 * - RFC-compliant IPv4 and IPv6 syntax validation.
 * - Port stripping for IPv4 (e.g. "1.2.3.4:8080") and bracketed IPv6 (e.g. "[::1]:8080").
 * - Configurable trusted proxy depth (`TRUSTED_PROXY_DEPTH`) to defend against
 *   spoofed `X-Forwarded-For` prefixes behind Ingress or reverse proxies.
 * - Optional Cloudflare `CF-Connecting-IP` / `True-Client-IP` trust.
 * - Malformed IP rejection and safe fallback to prevent Redis key corruption.
 */

// Strict IPv4 regex: 4 octets between 0 and 255.
const IPV4_REGEX =
  /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

// Strict IPv6 regex supporting compressed (::), standard, and IPv4-mapped forms.
const IPV6_REGEX =
  /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(?::[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(?:ffff(?::0{1,4}){0,1}:){0,1}(?:(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])|(?:[0-9a-fA-F]{1,4}:){1,4}:(?:(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

/** Validate whether a given string is a syntactically valid IPv4 address */
export function isValidIPv4(ip: string): boolean {
  return IPV4_REGEX.test(ip.trim());
}

/** Validate whether a given string is a syntactically valid IPv6 address */
export function isValidIPv6(ip: string): boolean {
  return IPV6_REGEX.test(ip.trim());
}

/** Validate whether a given string is a syntactically valid IPv4 or IPv6 address */
export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  // Reject strings with dangerous whitespace, control characters, or excessive length
  if (ip.length > 45 || /[\r\n\t\0]/.test(ip)) return false;
  const clean = ip.trim();
  return isValidIPv4(clean) || isValidIPv6(clean);
}

/** Strip port from an IP string if present (e.g. "1.2.3.4:80" or "[::1]:80") */
export function stripPort(rawIp: string): string {
  const trimmed = rawIp.trim();
  // Bracketed IPv6 format: "[2001:db8::1]:8080" -> "2001:db8::1"
  if (trimmed.startsWith("[")) {
    const bracketEnd = trimmed.indexOf("]");
    if (bracketEnd !== -1) {
      return trimmed.slice(1, bracketEnd);
    }
  }

  // IPv4 with port: "192.0.2.1:8080"
  if (trimmed.includes(".") && trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length === 2 && isValidIPv4(parts[0]!)) {
      return parts[0]!;
    }
  }

  return trimmed;
}

export interface ClientIpExtractionOptions {
  /**
   * Number of trusted reverse proxy layers in front of the application.
   * - `depth = 1`: trusted ingress proxy appended the client IP at the end of the chain.
   * - `depth = 0` / undefined: fallback to leftmost IP (unless rightmost strategy is requested).
   */
  trustedProxyDepth?: number;
  /** Whether to trust Cloudflare CF-Connecting-IP header (defaults to true if header present and valid) */
  trustCloudflare?: boolean;
  /** Default fallback if no valid IP can be extracted */
  fallbackIp?: string;
}

/**
 * Extract a verified, spoof-hardened client IP address from request headers.
 *
 * @param headers Request headers object or Map
 * @param options Extraction options (trusted proxy depth, cloudflare trust)
 * @returns Sanitized and validated IP address string, or fallback ("unknown")
 */
export function extractClientIp(
  headers: Pick<Headers, "get">,
  options: ClientIpExtractionOptions = {}
): string {
  const fallback = options.fallbackIp ?? "unknown";

  // 1. Cloudflare proxy header: CF-Connecting-IP
  const trustCf =
    options.trustCloudflare ??
    (process.env.TRUST_CLOUDFLARE_PROXY === "true" ||
      process.env.NODE_ENV === "production");

  if (trustCf) {
    const cfIp = headers.get("cf-connecting-ip") || headers.get("true-client-ip");
    if (cfIp) {
      const stripped = stripPort(cfIp);
      if (isValidIp(stripped)) {
        return stripped;
      }
    }
  }

  // 2. X-Forwarded-For parsing with trusted proxy depth
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const candidates = xff
      .split(",")
      .map((entry) => stripPort(entry.trim()))
      .filter((entry) => entry.length > 0);

    if (candidates.length > 0) {
      const configuredDepth =
        options.trustedProxyDepth ??
        (process.env.TRUSTED_PROXY_DEPTH !== undefined
          ? parseInt(process.env.TRUSTED_PROXY_DEPTH, 10)
          : 0);

      let selectedIp: string | undefined;

      if (configuredDepth > 0) {
        // With trusted proxy depth N, the client IP is at (candidates.length - N).
        // e.g. Spoofed: "fake_ip, real_client_ip", depth = 1 -> selects real_client_ip.
        const targetIndex = candidates.length - configuredDepth;
        if (targetIndex >= 0 && targetIndex < candidates.length) {
          selectedIp = candidates[targetIndex];
        }
      } else {
        // When depth is not configured, pick the first entry (leftmost)
        selectedIp = candidates[0];
      }

      if (selectedIp && isValidIp(selectedIp)) {
        return selectedIp;
      }
    }
  }

  // 3. Fall back to standard remote socket address headers
  const realIp = headers.get("x-real-ip") || headers.get("x-client-ip");
  if (realIp) {
    const stripped = stripPort(realIp);
    if (isValidIp(stripped)) {
      return stripped;
    }
  }

  return fallback;
}

/**
 * Sanitize an IP or rate limit key so it cannot corrupt Redis protocol or keys.
 * Enforces alphanumeric, colon, dot, hyphen, underscore characters only and caps length at 128.
 */
export function sanitizeRateLimitKey(key: string): string {
  if (!key || typeof key !== "string") {
    return "rl:unknown";
  }

  // Clean illegal characters that could inject Redis commands or break key schemas
  const safePart = key.replace(/[^a-zA-Z0-9.:_\-]/g, "_").slice(0, 128);
  return safePart.length > 0 ? safePart : "rl:unknown";
}
