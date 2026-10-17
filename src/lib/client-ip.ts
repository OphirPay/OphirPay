// SPDX-License-Identifier: MIT

/**
 * Hardened client IP address extraction for rate limiting and audit logging (#1387).
 *
 * Naive `X-Forwarded-For.split(",")[0]` extraction allows any client to bypass
 * IP-based rate limits by sending a spoofed `X-Forwarded-For: 1.2.3.4` header
 * on every request: the reverse proxy appends the real client IP to the *end*
 * of the header, leaving the attacker-controlled IP at index 0.
 *
 * This module parses `X-Forwarded-For` from right-to-left using the configured
 * `TRUSTED_PROXY_DEPTH` (or explicit `trustedProxyCidrs` list) and validates
 * that extracted addresses are well-formed IPv4 or IPv6 literals before using
 * them as rate-limiter bucket keys.
 */

export const DEFAULT_TRUSTED_PROXY_DEPTH = 1;
export const FALLBACK_CLIENT_IP = "unknown";

export interface ExtractClientIpOptions {
  /**
   * Number of trusted reverse-proxy hops appended to the right of the client IP
   * in `X-Forwarded-For`. Defaults to `TRUSTED_PROXY_DEPTH` env var or 1.
   */
  trustedProxyDepth?: number;
  /**
   * Optional list of trusted proxy IPv4 CIDR ranges (e.g. `["10.0.0.0/8", "198.51.100.0/24"]`).
   * When provided, rightmost hops matching these CIDRs are stripped first.
   */
  trustedProxyCidrs?: readonly string[];
  /** Bucket key returned when no valid IP address is present. Defaults to `"unknown"`. */
  fallback?: string;
}

type HeadersLike = Pick<Headers, "get">;

function extractHeaders(
  input: Request | { headers: HeadersLike } | HeadersLike
): HeadersLike {
  if ("get" in input && typeof input.get === "function") {
    return input;
  }
  return (input as { headers: HeadersLike }).headers;
}

/**
 * Resolve `TRUSTED_PROXY_DEPTH` from environment or explicit number.
 */
export function resolveTrustedProxyDepth(
  raw: string | number | undefined = process.env.TRUSTED_PROXY_DEPTH
): number {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0
      ? raw
      : DEFAULT_TRUSTED_PROXY_DEPTH;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_TRUSTED_PROXY_DEPTH;
}

/**
 * Validate whether `value` is a canonical dotted-quad IPv4 address (`0.0.0.0`–`255.255.255.255`).
 */
export function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return false;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return false;
  }
  return true;
}

/**
 * Validate whether `value` is a well-formed IPv6 address (including `::` compression
 * and optional embedded IPv4 suffix).
 */
export function isValidIpv6(value: string): boolean {
  if (!value || value.includes(":::")) return false;

  // Reject multiple `::` compressions
  const doubleColonParts = value.split("::");
  if (doubleColonParts.length > 2) return false;

  let working = value;
  let ipv4GroupCount = 0;

  // Handle embedded IPv4 at the end (e.g., `::ffff:192.0.2.128`)
  if (working.includes(".")) {
    const lastColon = working.lastIndexOf(":");
    if (lastColon === -1) return false;
    const ipv4Suffix = working.slice(lastColon + 1);
    if (!isValidIpv4(ipv4Suffix)) return false;
    working = working.slice(0, lastColon);
    ipv4GroupCount = 2; // IPv4 occupies 32 bits = 2 x 16-bit hextets
  }

  const [leftRaw, rightRaw] = working.split("::");
  const leftGroups = leftRaw ? leftRaw.split(":") : [];
  const rightGroups = rightRaw ? rightRaw.split(":") : [];

  const isHexGroup = (g: string) => /^[0-9a-fA-F]{1,4}$/.test(g);
  if (!leftGroups.every(isHexGroup) || !rightGroups.every(isHexGroup)) {
    return false;
  }

  const totalGroups =
    leftGroups.length + rightGroups.length + ipv4GroupCount;

  if (working.includes("::")) {
    return totalGroups < 8;
  }
  return totalGroups === 8;
}

/**
 * Normalize and validate an IP candidate string from an HTTP header.
 * Returns the canonical IP string or `null` if malformed.
 */
export function normalizeIpCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let candidate = raw.trim().replace(/^"+|"+$/g, "");
  if (!candidate || candidate.length > 64) return null;

  // Bracketed IPv6 with optional port: `[2001:db8::1]:8443`
  if (candidate.startsWith("[")) {
    const closeIdx = candidate.indexOf("]");
    if (closeIdx === -1) return null;
    const rest = candidate.slice(closeIdx + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return null;
    candidate = candidate.slice(1, closeIdx);
  } else if (candidate.includes(".") && /^\d+\.\d+\.\d+\.\d+:\d{1,5}$/.test(candidate)) {
    // IPv4 with port: `203.0.113.5:54321`
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  // Strip IPv6 zone index (`fe80::1%eth0`)
  const zoneIdx = candidate.indexOf("%");
  if (zoneIdx !== -1) {
    candidate = candidate.slice(0, zoneIdx);
  }

  // Normalize IPv4-mapped IPv6 (`::ffff:203.0.113.5` -> `203.0.113.5`)
  if (/^::ffff:/i.test(candidate)) {
    const tail = candidate.slice(7);
    if (isValidIpv4(tail)) {
      return tail;
    }
  }

  if (isValidIpv4(candidate)) {
    return candidate;
  }
  if (isValidIpv6(candidate)) {
    return candidate.toLowerCase();
  }
  return null;
}

function ipv4ToUint32(ip: string): number | null {
  if (!isValidIpv4(ip)) return null;
  return ip
    .split(".")
    .reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

/**
 * Check whether an IPv4 address belongs to a given IPv4 CIDR block (e.g. `10.0.0.0/8`).
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.trim().split("/");
  const ipNum = ipv4ToUint32(ip);
  const netNum = ipv4ToUint32(network);
  if (ipNum === null || netNum === null) return false;

  const prefix = prefixStr !== undefined ? Number(prefixStr) : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;

  const mask = (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

/**
 * Extract the authenticated client IP address from request headers using
 * right-to-left `X-Forwarded-For` traversal and strict IPv4/IPv6 validation.
 */
export function extractClientIp(
  input: Request | { headers: HeadersLike } | HeadersLike,
  options: ExtractClientIpOptions = {}
): string {
  const headers = extractHeaders(input);
  const fallback = options.fallback ?? FALLBACK_CLIENT_IP;
  const trustedProxyDepth =
    options.trustedProxyDepth ?? resolveTrustedProxyDepth();
  const trustedCidrs = options.trustedProxyCidrs;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const rawHops = xff.split(",");
    const validHops: string[] = [];

    // Walk from right to left: stop as soon as we encounter a malformed hop
    // so an attacker cannot shift the hop count with garbage entries.
    for (let i = rawHops.length - 1; i >= 0; i--) {
      const normalized = normalizeIpCandidate(rawHops[i]);
      if (!normalized) {
        break;
      }
      validHops.unshift(normalized);
    }

    if (validHops.length > 0) {
      if (trustedCidrs && trustedCidrs.length > 0) {
        let idx = validHops.length - 1;
        let stripped = 0;
        while (
          idx > 0 &&
          stripped < trustedProxyDepth &&
          trustedCidrs.some((cidr) => isIpInCidr(validHops[idx], cidr))
        ) {
          idx--;
          stripped++;
        }
        return validHops[idx];
      }

      const targetIndex = Math.max(
        0,
        validHops.length - 1 - trustedProxyDepth
      );
      return validHops[targetIndex];
    }
  }

  const realIp = normalizeIpCandidate(headers.get("x-real-ip"));
  if (realIp) return realIp;

  const cfIp = normalizeIpCandidate(headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;

  return fallback;
}
