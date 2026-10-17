// SPDX-License-Identifier: MIT

/**
 * Hardened client IP extraction and validation utility.
 * Prevents IP spoofing via untrusted X-Forwarded-For headers and validates
 * strict IPv4 / IPv6 syntax to protect Redis rate limiter keys from injection (#1387).
 */

const IPV4_SEGMENT_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * Validates strict IPv4 address format (dotted decimal, 0.0.0.0 to 255.255.255.255).
 * Disallows leading zeros to prevent octal ambiguity.
 */
export function isValidIPv4(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => IPV4_SEGMENT_REGEX.test(part));
}

/**
 * Validates strict IPv6 address format (standard hex, compressed ::, and IPv4-mapped).
 */
export function isValidIPv6(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  // Handle bracketed IPv6 e.g. [::1]
  const cleanIp = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;

  // Handle IPv4-mapped IPv6 e.g. ::ffff:192.0.2.1
  if (cleanIp.includes(".")) {
    const lastColon = cleanIp.lastIndexOf(":");
    if (lastColon === -1) return false;
    const v6Prefix = cleanIp.slice(0, lastColon);
    const v4Suffix = cleanIp.slice(lastColon + 1);
    if (!isValidIPv4(v4Suffix)) return false;
    return (
      v6Prefix === "" ||
      v6Prefix === ":" ||
      v6Prefix === "::" ||
      v6Prefix.toLowerCase() === "::ffff" ||
      v6Prefix.toLowerCase() === "0:0:0:0:0:ffff"
    );
  }

  // Pure IPv6
  const doubleColonCount = (cleanIp.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  const parts = cleanIp.split(":");
  if (doubleColonCount === 1) {
    if (parts.length > 8) return false;
    return parts.every((p) => p === "" || /^[0-9a-fA-F]{1,4}$/.test(p));
  }

  if (parts.length !== 8) return false;
  return parts.every((p) => /^[0-9a-fA-F]{1,4}$/.test(p));
}

/**
 * Validates that an IP string is a syntactically valid IPv4 or IPv6 address.
 */
export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const clean = ip.trim();
  return isValidIPv4(clean) || isValidIPv6(clean);
}

/**
 * Strips port numbers from host:port strings (e.g. 192.0.2.1:8080 -> 192.0.2.1 or [2001:db8::1]:8080 -> 2001:db8::1).
 */
export function stripPort(ipWithPort: string): string {
  if (!ipWithPort) return "";
  const trimmed = ipWithPort.trim();
  if (trimmed.startsWith("[") && trimmed.includes("]:")) {
    const closeBracket = trimmed.indexOf("]");
    return trimmed.slice(1, closeBracket);
  }
  if (!trimmed.includes(":") && trimmed.includes(".")) {
    return trimmed;
  }
  if (trimmed.includes(".") && trimmed.includes(":")) {
    // IPv4 with port e.g. 1.2.3.4:8080
    const parts = trimmed.split(":");
    if (parts.length === 2 && isValidIPv4(parts[0])) {
      return parts[0];
    }
  }
  return trimmed;
}

export interface ClientIpOptions {
  /**
   * Number of trusted reverse proxies in front of the application.
   * When specified, traverses the X-Forwarded-For list from right to left.
   */
  trustedProxyDepth?: number;
  /**
   * Whether to trust Cloudflare cf-connecting-ip header. Defaults to true.
   */
  trustCloudflare?: boolean;
}

/**
 * Extracts and validates client IP from request headers.
 * Protects against X-Forwarded-For spoofing and header injection.
 */
export function extractClientIp(
  headers: Pick<Headers, "get">,
  options: ClientIpOptions = {}
): string {
  const trustCf = options.trustCloudflare ?? true;
  const configuredDepth =
    options.trustedProxyDepth ??
    (process.env.TRUSTED_PROXY_DEPTH ? parseInt(process.env.TRUSTED_PROXY_DEPTH, 10) : undefined);

  // 1. Cloudflare connecting IP (if trusted and present)
  if (trustCf) {
    const cfIp = headers.get("cf-connecting-ip");
    if (cfIp) {
      const cleanCf = stripPort(cfIp);
      if (isValidIp(cleanCf)) return cleanCf;
    }
  }

  // 2. X-Forwarded-For parsing with proxy depth validation
  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const rawList = xForwardedFor.split(",").map((s) => stripPort(s.trim()));
    const validIps = rawList.filter((entry) => isValidIp(entry));

    if (validIps.length > 0) {
      if (configuredDepth !== undefined && Number.isFinite(configuredDepth) && configuredDepth > 0) {
        // Traverses from right based on trusted proxy depth
        const targetIndex = Math.max(0, validIps.length - configuredDepth);
        const chosen = validIps[targetIndex];
        if (isValidIp(chosen)) return chosen;
      } else {
        // Default: leftmost valid entry
        const chosen = validIps[0];
        if (isValidIp(chosen)) return chosen;
      }
    }
  }

  // 3. Direct real IP from ingress / reverse proxy
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const cleanReal = stripPort(realIp);
    if (isValidIp(cleanReal)) return cleanReal;
  }

  // 4. Fallback headers
  const clientIp = headers.get("x-client-ip");
  if (clientIp) {
    const cleanClient = stripPort(clientIp);
    if (isValidIp(cleanClient)) return cleanClient;
  }

  return "unknown";
}

/**
 * Normalizes and sanitizes IP for safe use as a Redis key component,
 * ensuring no control characters or unexpected delimiters exist.
 */
export function sanitizeIpForRedisKey(ip: string): string {
  if (!isValidIp(ip)) return "unknown";
  return ip.replace(/[^a-zA-Z0-9.:_-]/g, "");
}
