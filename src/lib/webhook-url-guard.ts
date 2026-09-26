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
 *   • Ports other than the allow-list (default 80 and 443 — issue #706)
 *   • Loopback / link-local / private IPv4 ranges (literal addresses)
 *   • IPv4 ranges reserved for documentation, benchmarking and multicast
 *   • IPv6 loopback, unspecified, ULA (fc00::/7), link-local (fe80::/10),
 *     and IPv4-mapped/‑compatible addresses whose embedded IPv4 is private
 *   • Hostnames that resolve to localhost / .local / .internal suffixes
 *
 * DNS rebinding (hostname that resolves publicly at validation time but
 * privately at delivery time) is mitigated by re-validating the host
 * immediately before **every** delivery attempt in `deliverWebhook` — not
 * once per registration — so the decision is made against the address the
 * connection is about to use.
 */

import { isIP } from "node:net";

/**
 * Ports a webhook target may use. Override with the comma-separated
 * `WEBHOOK_ALLOWED_PORTS` env var when a subscriber genuinely needs another
 * port; anything not listed is rejected (issue #706).
 */
export const DEFAULT_ALLOWED_WEBHOOK_PORTS: readonly number[] = [80, 443];

/** Resolve the configured webhook target port allow-list. */
export function getAllowedWebhookPorts(): number[] {
  const raw = process.env.WEBHOOK_ALLOWED_PORTS;
  if (!raw) return [...DEFAULT_ALLOWED_WEBHOOK_PORTS];
  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_WEBHOOK_PORTS];
}

/** Blocked IPv4 ranges as [start, end] u32 pairs (inclusive). */
const PRIVATE_IPV4: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 "this network"
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 private
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local (cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 IETF protocol assignments
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 TEST-NET-1
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 reserved + 255.255.255.255
];

function ipv4ToU32(parts: number[]): number {
  return (
    ((parts[0]! << 24) >>> 0) +
    ((parts[1]! << 16) >>> 0) +
    ((parts[2]! << 8) >>> 0) +
    parts[3]!
  );
}

function isPrivateIpv4Bytes(bytes: number[]): boolean {
  if (bytes.length !== 4) return false;
  const value = ipv4ToU32(bytes);
  return PRIVATE_IPV4.some(([start, end]) => value >= start && value <= end);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  return isPrivateIpv4Bytes(parts);
}

/**
 * Expand an IPv6 literal to its 16 bytes. Returns null when the address is
 * malformed (the caller treats null as unsafe).
 */
function ipv6ToBytes(address: string): number[] | null {
  let addr = address.toLowerCase().split("%")[0]!;

  // An embedded IPv4 tail (::ffff:127.0.0.1, ::127.0.0.1, …)
  let ipv4: number[] | null = null;
  const v4 = addr.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    ipv4 = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (ipv4.some((p) => p > 255)) return null;
    addr = addr.slice(0, addr.length - v4[0].length).replace(/:$/, "");
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":").filter((h) => h !== "") : [];
  const tail =
    halves.length === 2 && halves[1]
      ? halves[1].split(":").filter((h) => h !== "")
      : [];

  const groups: string[] = [...head];
  const present = head.length + tail.length + (ipv4 ? 2 : 0);
  if (halves.length === 2) {
    const missing = 8 - present;
    if (missing < 0) return null;
    groups.push(...Array.from({ length: missing }, () => "0"));
  } else if (present !== 8) {
    return null;
  }
  groups.push(...tail);

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  if (ipv4) bytes.push(...ipv4);

  return bytes.length === 16 ? bytes : null;
}

function isPrivateIpv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  // Unparseable addresses are treated as unsafe rather than allowed.
  if (!bytes) return true;

  const zeroPrefix = (n: number) => bytes.slice(0, n).every((b) => b === 0);

  // :: (unspecified) and ::1 (loopback)
  if (zeroPrefix(16)) return true;
  if (zeroPrefix(15) && bytes[15] === 1) return true;

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 — judge by the
  // embedded IPv4 (only the private/loopback ranges are blocked).
  const isMapped =
    zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompatible = zeroPrefix(12);
  if (isMapped || isCompatible) {
    return isPrivateIpv4Bytes(bytes.slice(12));
  }

  // Unique local addresses fc00::/7
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  // Link-local unicast fe80::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  // Multicast ff00::/8
  if (bytes[0] === 0xff) return true;

  return false;
}

/** Block hostnames that can never be a legitimate public webhook target. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.home\.arpa$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data.*$/i,
];

/**
 * Return true when `url` is a safe public http(s) webhook endpoint: an
 * allowed port, no embedded credentials, and a destination that is not a
 * private/loopback/link-local address.
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

  // Port allow-list: an explicit port must be listed; otherwise the scheme
  // default (80/443) applies.
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80;
  if (!getAllowedWebhookPorts().includes(port)) return false;

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
 * Re-validate a webhook URL immediately before a delivery attempt.
 *
 * Runs the static checks in `isSafeWebhookUrl` and then re-resolves the host,
 * refusing the delivery unless **every** resolved address is public. This is
 * what neutralises DNS rebinding: the check is made against the address the
 * connection is about to use, not the resolution at registration time.
 *
 * Returns true only when the currently-resolved address is public and the
 * port/scheme checks pass.
 */
export type WebhookUrlValidation =
  | { valid: true; url: string }
  | { valid: false; url: string; reason: string };

export async function validateWebhookUrlAtDelivery(url: string): Promise<WebhookUrlValidation> {
  if (!isSafeWebhookUrl(url)) {
    return {
      valid: false,
      url,
      reason: "Webhook target must be a public http(s) URL and cannot point to a private, local, or reserved address.",
    };
  }

  try {
    const { lookup } = await import("node:dns/promises");
    const addresses = await lookup(new URL(url).hostname, { all: true });
    const isPublic = addresses.length > 0 && addresses.every((a) => {
      const version = isIP(a.address);
      if (version === 4) return !isPrivateIpv4(a.address);
      if (version === 6) return !isPrivateIpv6(a.address);
      return false;
    });
    if (!isPublic) {
      return {
        valid: false,
        url,
        reason: "Webhook target resolved to a private, local, or reserved address and was rejected by the URL guard.",
      };
    }
    return { valid: true, url };
  } catch {
    return {
      valid: false,
      url,
      reason: "Webhook target could not be resolved publicly, so the URL guard rejected it before delivery.",
    };
  }
}

export async function isSafeWebhookUrlAtDelivery(url: string): Promise<boolean> {
  return (await validateWebhookUrlAtDelivery(url)).valid;
}
