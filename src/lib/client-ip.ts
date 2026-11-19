// SPDX-License-Identifier: MIT

/**
 * Client IP address extraction and validation utility.
 *
 * Hardened against X-Forwarded-For header spoofing behind reverse proxies,
 * load balancers (Cloudflare, AWS ALB), and Kubernetes ingress.
 *
 * Edge runtime safe: does not use Node.js `net` module.
 */

export interface ClientIpOptions {
  /**
   * Number of trusted reverse proxy hops in front of the application.
   * Default: 1 (reads from TRUSTED_PROXY_DEPTH environment variable, fallback 1).
   */
  trustedProxyDepth?: number;
  /**
   * Fallback IP to return when no valid IP can be extracted.
   * Default: "unknown".
   */
  fallbackIp?: string;
}

/**
 * Validates whether the given string is a valid IPv4 address.
 * Rejects leading zeroes (except single 0), numbers > 255, and non-numeric chars.
 */
export function isValidIpv4(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const num = parseInt(part, 10);
    if (num < 0 || num > 255) return false;
    if (part.length > 1 && part.startsWith("0")) return false;
  }
  return true;
}

/**
 * Validates whether the given string is a valid IPv6 address.
 * Edge-runtime safe RFC 4291 parser supporting compressed `::` and IPv4-mapped IPv6.
 */
export function isValidIpv6(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  if (!trimmed) return false;

  // Cannot contain more than one "::"
  if (trimmed.split("::").length > 2) return false;

  let checkIp = trimmed;
  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:192.0.2.128)
  if (checkIp.includes(".")) {
    const lastColon = checkIp.lastIndexOf(":");
    if (lastColon === -1) return false;
    const ipv4Part = checkIp.slice(lastColon + 1);
    if (!isValidIpv4(ipv4Part)) return false;
    checkIp = checkIp.slice(0, lastColon) + ":0:0";
  }

  const isCompressed = checkIp.includes("::");
  if (isCompressed) {
    const [head, tail] = checkIp.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    if (headParts.length + tailParts.length > 7) return false;
    for (const part of [...headParts, ...tailParts]) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
    }
    return true;
  } else {
    const parts = checkIp.split(":");
    if (parts.length !== 8) return false;
    for (const part of parts) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
    }
    return true;
  }
}

/**
 * Strip optional port from an IPv4 or bracketed IPv6 address.
 * e.g. "203.0.113.195:8080" -> "203.0.113.195"
 *      "[2001:db8::1]:8080" -> "2001:db8::1"
 *      "[2001:db8::1]"      -> "2001:db8::1"
 */
export function stripPort(ip: string): string {
  if (!ip || typeof ip !== "string") return "";
  const trimmed = ip.trim();

  // Bracketed IPv6: [2001:db8::1]:8080 or [2001:db8::1]
  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket !== -1) {
      return trimmed.slice(1, closingBracket);
    }
  }

  // IPv4 with port: exactly one colon
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex !== -1 && colonIndex === trimmed.lastIndexOf(":")) {
    const host = trimmed.slice(0, colonIndex);
    const port = trimmed.slice(colonIndex + 1);
    if (/^\d+$/.test(port) && isValidIpv4(host)) {
      return host;
    }
  }

  return trimmed;
}

/**
 * Checks whether an IP string is a valid IPv4 or IPv6 address.
 */
export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const cleaned = stripPort(ip);
  return isValidIpv4(cleaned) || isValidIpv6(cleaned);
}

/**
 * Resolves the configured trusted proxy depth.
 */
export function getTrustedProxyDepth(explicitDepth?: number): number {
  if (typeof explicitDepth === "number" && !isNaN(explicitDepth) && explicitDepth >= 1) {
    return explicitDepth;
  }
  const envVal = parseInt(process.env.TRUSTED_PROXY_DEPTH || "1", 10);
  return isNaN(envVal) || envVal < 1 ? 1 : envVal;
}

/**
 * Sanitizes a string before using it as part of a Redis rate-limiting key.
 * Strips whitespace, control characters, and newlines that could break Redis commands
 * or cause key-space injection.
 */
export function sanitizeRateLimitKey(key: string): string {
  if (!key || typeof key !== "string") return "unknown";
  const cleaned = key.trim().replace(/[\s\r\n\x00-\x1f\x7f]+/g, "_");
  return cleaned || "unknown";
}

/**
 * Safely extracts client IP from request headers, defending against header spoofing.
 *
 * 1. Cloudflare / Enterprise headers (`cf-connecting-ip`, `true-client-ip`):
 *    Trusted if valid, as Cloudflare strips client-supplied instances at edge.
 * 2. `x-forwarded-for`:
 *    Selects from the rightmost entries based on `TRUSTED_PROXY_DEPTH` (default 1).
 *    Leftmost client-spoofed IPs are ignored.
 * 3. `x-real-ip`:
 *    Trusted fallback if set by upstream reverse proxy.
 * 4. Fallback to `options.fallbackIp` (default "unknown").
 */
export function getClientIp(
  headers: Pick<Headers, "get">,
  options?: ClientIpOptions
): string {
  const fallback = options?.fallbackIp ?? "unknown";

  // 1. Cloudflare / CDN headers
  const cfIp = headers.get("cf-connecting-ip")?.trim() || headers.get("true-client-ip")?.trim();
  if (cfIp) {
    const stripped = stripPort(cfIp);
    if (isValidIp(stripped)) return stripped;
  }

  // 2. X-Forwarded-For parsing with trusted depth from the right
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((part) => stripPort(part.trim()))
      .filter(Boolean);

    // Filter valid IPs only
    const validParts = parts.filter(isValidIp);

    if (validParts.length > 0) {
      const depth = getTrustedProxyDepth(options?.trustedProxyDepth);
      // Pick index from rightmost: length - depth
      const targetIndex = Math.max(0, validParts.length - depth);
      const selected = validParts[targetIndex];
      if (selected && isValidIp(selected)) {
        return selected;
      }
    }
  }

  // 3. X-Real-IP fallback
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    const stripped = stripPort(realIp);
    if (isValidIp(stripped)) return stripped;
  }

  return fallback;
}
