// SPDX-License-Identifier: MIT

/**
 * Custom Stellar RPC endpoint validation (issue #1957).
 *
 * Validates user-supplied custom Stellar Soroban RPC URLs in settings to ensure
 * they use secure and valid schemes (`https://` or `wss://`), and prevents
 * SSRF targeting internal infrastructure or private network addresses in
 * non-development environments.
 *
 * In local development (`NODE_ENV === 'development'`), loopback / localhost
 * endpoints with `http://` or `ws://` schemes are permitted to facilitate
 * local Standalone Soroban nodes.
 */

import { isIP } from "node:net";

import { z } from "zod";

/** Permitted protocol schemes for RPC endpoints. */
export const PERMITTED_RPC_SCHEMES = ["https:", "wss:"] as const;

/** Blocked IPv4 ranges as [start, end] u32 pairs (inclusive). */
const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 private
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 private
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 IETF
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 TEST-NET-1
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 private
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 multicast
  [0xf0000000, 0xffffffff], // 240.0.0.0/4 reserved
];

function ipv4ToU32(ip: string): number {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0) >>> 0
  );
}

function isPrivateIpv4(ip: string): boolean {
  const num = ipv4ToU32(ip);
  return PRIVATE_IPV4_RANGES.some(([start, end]) => num >= start && num <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  return false;
}

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
 * Validates whether an RPC URL string is valid and permitted for the current environment.
 */
export function isValidRpcEndpoint(
  urlString: string,
  env: string = process.env.NODE_ENV || "development"
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  // Reject embedded credentials (user:pass@host)
  if (parsed.username || parsed.password) {
    return false;
  }

  const isDev = env === "development";
  const protocol = parsed.protocol.toLowerCase();

  // In production/staging: scheme must be https: or wss:
  if (!isDev) {
    if (protocol !== "https:" && protocol !== "wss:") {
      return false;
    }
  } else {
    // In dev: https:, wss:, or http:/ws: if pointing to localhost/loopback
    if (protocol !== "https:" && protocol !== "wss:") {
      if (protocol === "http:" || protocol === "ws:") {
        const host = parsed.hostname.toLowerCase();
        const isLoopback =
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "[::1]" ||
          host === "::1";
        if (!isLoopback) return false;
      } else {
        return false;
      }
    }
  }

  // Check host for loopback or private ranges unless in development mode
  if (!isDev) {
    const rawHost = parsed.hostname.replace(/^\[|\]$/g, "");
    const ipVersion = isIP(rawHost);

    if (ipVersion === 4 && isPrivateIpv4(rawHost)) return false;
    if (ipVersion === 6 && isPrivateIpv6(rawHost)) return false;

    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(rawHost)) return false;
    }
  }

  return true;
}

/**
 * Schema for custom RPC endpoint URLs.
 */
export const rpcEndpointSchema = z
  .string()
  .min(1, "RPC URL is required")
  .refine(
    (url) => isValidRpcEndpoint(url, process.env.NODE_ENV),
    {
      message:
        process.env.NODE_ENV === "development"
          ? "Custom RPC endpoint URL must use https:// or wss:// (or http/ws on localhost in development)"
          : "Custom RPC endpoint URL must use a valid https:// or wss:// scheme",
    }
  );

/**
 * Schema for updating user/application settings.
 */
export const updateSettingsSchema = z.object({
  rpcUrl: rpcEndpointSchema.optional(),
  customRpcUrl: rpcEndpointSchema.optional(),
  network: z.enum(["TESTNET", "PUBLIC", "FUTURENET", "STANDALONE"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
