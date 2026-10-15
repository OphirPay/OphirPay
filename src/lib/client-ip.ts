// SPDX-License-Identifier: MIT

/**
 * Client IP address extraction and validation utility (issue #1387).
 *
 * Hardens IP extraction against header spoofing, proxy manipulation,
 * and malformed Redis key injection.
 *
 * Supports:
 * - CF-Connecting-IP (Cloudflare)
 * - X-Forwarded-For with configurable TRUSTED_PROXY_DEPTH
 * - X-Real-IP
 * - Remote socket address fallback
 * - Strict IPv4 and IPv6 syntax verification (Edge runtime compatible)
 */

export interface ClientIpOptions {
  /**
   * Number of trusted reverse proxy hops from the right of X-Forwarded-For.
   * If unset, reads process.env.TRUSTED_PROXY_DEPTH (defaults to undefined).
   * When defined and > 0, selects `ips[ips.length - depth]`, ignoring spoofed leftmost IPs.
   */
  trustedProxyDepth?: number;
  /**
   * Remote socket IP address fallback (e.g. connection remote address).
   */
  remoteAddress?: string;
}

const IPV4_REGEX =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/;

const IPV6_REGEX =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/;

/**
 * Checks if a string is a valid IPv4 address.
 */
export function isIPv4(ip: string): boolean {
  return typeof ip === "string" && IPV4_REGEX.test(ip.trim());
}

/**
 * Checks if a string is a valid IPv6 address.
 */
export function isIPv6(ip: string): boolean {
  return typeof ip === "string" && IPV6_REGEX.test(ip.trim());
}

/**
 * Validates that an IP string is syntactically a valid IPv4 or IPv6 address.
 */
export function isValidIp(ip: string): boolean {
  if (typeof ip !== "string" || !ip) return false;
  const trimmed = ip.trim();
  return isIPv4(trimmed) || isIPv6(trimmed);
}

/**
 * Cleans an IP address by trimming whitespace, stripping surrounding brackets,
 * and removing any appended port number (e.g. "192.0.2.1:8080" -> "192.0.2.1").
 */
export function cleanIp(raw: string): string {
  if (typeof raw !== "string") return "";
  let val = raw.trim();

  // Strip enclosing brackets for IPv6 like [2001:db8::1] or [2001:db8::1]:8080
  const bracketMatch = val.match(/^\[([0-9a-fA-F:]+)\](?::\d+)?$/);
  if (bracketMatch) {
    return bracketMatch[1];
  }

  // Strip port for IPv4 like 1.2.3.4:8080
  const portMatch = val.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  if (portMatch) {
    return portMatch[1];
  }

  return val;
}

/**
 * Extracts and hardens client IP address from request headers or NextRequest.
 */
export function getClientIp(
  target:
    | Headers
    | Pick<Headers, "get">
    | { headers: Headers | Pick<Headers, "get">; ip?: string },
  options?: ClientIpOptions
): string {
  if (!target) return "unknown";

  const headers: Pick<Headers, "get"> =
    "headers" in target && target.headers
      ? target.headers
      : (target as Pick<Headers, "get">);

  const socketIp =
    "ip" in target && typeof target.ip === "string"
      ? target.ip
      : options?.remoteAddress;

  // 1. Cloudflare CF-Connecting-IP takes highest precedence when valid
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) {
    const cleaned = cleanIp(cfIp);
    if (isValidIp(cleaned)) {
      return cleaned;
    }
  }

  // 2. X-Forwarded-For with TRUSTED_PROXY_DEPTH support
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const rawIps = xff
      .split(",")
      .map((entry) => cleanIp(entry))
      .filter((entry) => entry.length > 0);

    if (rawIps.length > 0) {
      let depth = options?.trustedProxyDepth;
      if (depth === undefined && process.env.TRUSTED_PROXY_DEPTH) {
        const parsedDepth = parseInt(process.env.TRUSTED_PROXY_DEPTH, 10);
        if (Number.isFinite(parsedDepth) && parsedDepth > 0) {
          depth = parsedDepth;
        }
      }

      let candidate: string | undefined;
      if (depth !== undefined && depth > 0) {
        const targetIndex = rawIps.length - depth;
        candidate = targetIndex >= 0 ? rawIps[targetIndex] : rawIps[0];
      } else {
        candidate = rawIps[0];
      }

      if (candidate && isValidIp(candidate)) {
        return candidate;
      }
    }
  }

  // 3. X-Real-IP
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const cleaned = cleanIp(realIp);
    if (isValidIp(cleaned)) {
      return cleaned;
    }
  }

  // 4. Remote socket address fallback
  if (socketIp) {
    const cleaned = cleanIp(socketIp);
    if (isValidIp(cleaned)) {
      return cleaned;
    }
  }

  return "unknown";
}
