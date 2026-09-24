// SPDX-License-Identifier: MIT

/**
 * SSRF guard for user-supplied webhook URLs.
 *
 * OphirPay's server delivers webhooks by making outbound HTTP requests to
 * URLs users register. Without a guard, a malicious user could register
 * http://169.254.169.254/ (cloud metadata), http://localhost:5432 (internal
 * DB), or other internal endpoints and turn the server into a proxy.
 *
 * This guard blocks:
 *   • Non-http(s) schemes
 *   • Non-standard ports (allowed ports default to 80 and 443, configurable)
 *   • Loopback / link-local / private IPv4 ranges (literal addresses)
 *   • IPv6 loopback, private ranges, link-local, ULA, and IPv4-mapped addresses
 *   • Hostnames that resolve to localhost / .local / .internal / cloud metadata suffixes
 *
 * DNS rebinding (hostname that resolves publicly at validation time but
 * privately at delivery time) is mitigated by re-resolving and re-validating
 * immediately before each delivery attempt in `deliverWebhook`.
 */

import { isIP } from "node:net";
import dns from "node:dns";

/** Allowed ports for webhook endpoints (default 80, 443). */
export const DEFAULT_ALLOWED_PORTS = [80, 443];

/** Blocked IPv4 ranges as [start, end] u32 pairs (inclusive). */
const PRIVATE_IPV4: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT (Carrier-Grade NAT)
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local (cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc0000000, 0xc0000007], // 192.0.0.0/29 DS-Lite
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 reserved / broadcast
];

function ipv4ToU32(parts: number[]): number {
  return (
    ((parts[0]! << 24) >>> 0) +
    ((parts[1]! << 16) >>> 0) +
    ((parts[2]! << 8) >>> 0) +
    parts[3]!
  );
}

export function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const value = ipv4ToU32(parts);
  return PRIVATE_IPV4.some(([start, end]) => value >= start && value <= end);
}

export function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") || // fc00::/7 ULA (Unique Local Address)
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") || // fe80::/10 link-local
    lower.startsWith("ff") || // ff00::/8 multicast
    lower.startsWith("2001:db8:") // documentation prefix
  ) {
    return true;
  }

  // IPv4-mapped IPv6 like ::ffff:127.0.0.1 (standard dot-decimal)
  const mappedMatch = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) return isPrivateIpv4(mappedMatch[1]!);

  // IPv4-compatible IPv6 like ::127.0.0.1
  const compatMatch = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (compatMatch) return isPrivateIpv4(compatMatch[1]!);

  // URL parser expands IPv4-mapped or IPv4-compatible IPv6 into hex groups e.g. ::ffff:7f00:1 or ::7f00:1
  const suffixMatch = lower.match(/^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (suffixMatch) {
    const high = parseInt(suffixMatch[1], 16);
    const low = parseInt(suffixMatch[2], 16);
    if (!Number.isNaN(high) && !Number.isNaN(low)) {
      const u32 = ((high << 16) >>> 0) + low;
      return PRIVATE_IPV4.some(([start, end]) => u32 >= start && u32 <= end);
    }
  }

  return false;
}

/** Block hostnames that can never be a legitimate public webhook target. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.localdomain$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data.*$/i,
];

export interface WebhookUrlGuardOptions {
  allowedPorts?: number[];
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

/**
 * Default DNS resolver using dns.lookup
 */
export async function defaultDnsLookup(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses as Array<{ address: string; family: number }>);
    });
  });
}

/**
 * Return true when `url` is a safe public http(s) webhook endpoint.
 */
export function isSafeWebhookUrl(url: string, options?: WebhookUrlGuardOptions): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // Port restriction (defaults to 80 and 443)
  const allowedPorts = options?.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
  if (Number.isNaN(port) || !allowedPorts.includes(port)) {
    return false;
  }

  // Node's URL.hostname keeps brackets around IPv6 literals (e.g. "[::1]")
  const host = parsed.hostname.replace(/^\[|\]$/g, "");

  // Reject credentials in the URL (user:pass@host) — unnecessary and risky
  if (parsed.username || parsed.password) return false;

  // Literal IP checks
  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIpv4(host)) return false;
  if (ipVersion === 6 && isPrivateIpv6(host)) return false;

  // Hostname pattern checks
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) return false;
  }

  return true;
}

/**
 * Re-validate a webhook URL at delivery time to mitigate DNS rebinding.
 * Returns true only when the URL is syntactically safe, uses allowed ports,
 * and every currently-resolved DNS address is public and non-private.
 */
export async function isSafeWebhookUrlAtDelivery(
  url: string,
  options?: WebhookUrlGuardOptions
): Promise<boolean> {
  if (!isSafeWebhookUrl(url, options)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");

    // If host is already an IP literal, it was validated in isSafeWebhookUrl
    if (isIP(host) !== 0) {
      return true;
    }

    const lookupFn = options?.dnsLookup ?? defaultDnsLookup;
    const addresses = await lookupFn(host);
    if (!addresses || addresses.length === 0) {
      return false;
    }
    return addresses.every((a) => {
      const v = isIP(a.address);
      if (v === 4) return !isPrivateIpv4(a.address);
      if (v === 6) return !isPrivateIpv6(a.address);
      return false;
    });
  } catch {
    // DNS failure — refuse delivery rather than hitting an unknown host
    return false;
  }
}
