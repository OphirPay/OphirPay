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
 *   • Loopback / link-local / private IPv4 ranges (literal addresses)
 *   • IPv6 loopback and private ranges
 *   • Hostnames that resolve to localhost / .local / .internal suffixes
 *
 * DNS rebinding (hostname that resolves publicly at validation time but
 * privately at delivery time) is mitigated by re-validating the host on
 * every delivery in `deliverWebhook`.
 */

import { isIP } from "node:net";

/** Blocked IPv4 ranges as [start, end] u32 pairs (inclusive). */
const PRIVATE_IPV4: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local (cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
];

function ipv4ToU32(parts: number[]): number {
  return (
    ((parts[0]! << 24) >>> 0) +
    ((parts[1]! << 16) >>> 0) +
    ((parts[2]! << 8) >>> 0) +
    parts[3]!
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const value = ipv4ToU32(parts);
  return PRIVATE_IPV4.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") || // fc00::/7 ULA
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") || // fe80::/10 link-local
    lower.includes("::ffff:") // mapped IPv4 — handled separately below
  ) {
    return true;
  }
  // IPv4-mapped IPv6 like ::ffff:127.0.0.1
  const mappedMatch = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) return isPrivateIpv4(mappedMatch[1]!);
  return false;
}

/** Block hostnames that can never be a legitimate public webhook target. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data.*$/i,
];

/**
 * Return true when `url` is a safe public http(s) webhook endpoint.
 */
export function isSafeWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

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
 * Returns true only when the currently-resolved address is public.
 */
export async function isSafeWebhookUrlAtDelivery(url: string): Promise<boolean> {
  if (!isSafeWebhookUrl(url)) return false;
  try {
    const { lookup } = await import("node:dns/promises");
    const addresses = await lookup(new URL(url).hostname, { all: true });
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
