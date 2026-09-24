// SPDX-License-Identifier: MIT

import type { Sep24AnchorConfig, Sep24AssetInfo } from "./types";

interface CacheEntry {
  config: Sep24AnchorConfig;
  expiresAt: number;
}

const anchorCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Basic TOML key-value and section parser for stellar.toml discovery.
 */
export function parseStellarToml(tomlText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = tomlText.split(/\r?\n/);
  let currentSection = "";

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    // Check for section header [SECTION] or [[ARRAY]]
    const sectionMatch = line.match(/^\[\[?([a-zA-Z0-9_.-]+)\]?\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toUpperCase();
      if (!result[currentSection]) {
        result[currentSection] = [];
      }
      continue;
    }

    // Key-value pairs
    const kvMatch = line.match(/^([a-zA-Z0-9_.-]+)\s*=\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let valStr = kvMatch[2].trim();

      // Strip quotes
      if (
        (valStr.startsWith('"') && valStr.endsWith('"')) ||
        (valStr.startsWith("'") && valStr.endsWith("'"))
      ) {
        valStr = valStr.slice(1, -1);
      }

      let parsedVal: unknown = valStr;
      if (valStr.toLowerCase() === "true") parsedVal = true;
      else if (valStr.toLowerCase() === "false") parsedVal = false;
      else if (!isNaN(Number(valStr)) && valStr !== "") parsedVal = Number(valStr);

      if (currentSection && Array.isArray(result[currentSection])) {
        // Appending to currency table
        const arr = result[currentSection] as Record<string, unknown>[];
        if (arr.length === 0 || key.toUpperCase() === "CODE") {
          arr.push({ [key]: parsedVal });
        } else {
          arr[arr.length - 1][key] = parsedVal;
        }
      } else {
        result[key.toUpperCase()] = parsedVal;
      }
    }
  }

  return result;
}

/**
 * Validate that domain is safe from SSRF attacks.
 */
function isSafeDomain(domain: string, allowHttp: boolean): boolean {
  if (!domain || typeof domain !== "string") return false;
  const clean = domain.trim().toLowerCase();

  if (!allowHttp) {
    if (
      clean.includes("localhost") ||
      clean.startsWith("127.") ||
      clean.startsWith("10.") ||
      clean.startsWith("192.168.") ||
      clean.startsWith("169.254.") ||
      clean.endsWith(".internal") ||
      clean.endsWith(".local")
    ) {
      return false;
    }
  }

  return /^[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(clean);
}

/**
 * Discover an anchor's SEP-24 configuration by reading their SEP-1 stellar.toml
 * and querying their /info endpoint.
 *
 * @param domain Anchor domain (e.g. "testnet.kado.sh" or "testanchor.stellar.org")
 * @param allowHttp Allow HTTP schemes (for local mock servers in test suites)
 */
export async function discoverAnchor(
  domain: string,
  allowHttp: boolean = false
): Promise<Sep24AnchorConfig> {
  const cleanDomain = domain.trim().toLowerCase();

  if (!isSafeDomain(cleanDomain, allowHttp)) {
    throw new Error(`Invalid or unsafe anchor domain: "${domain}"`);
  }

  const cacheKey = `${cleanDomain}:${allowHttp}`;
  const cached = anchorCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const scheme = allowHttp || cleanDomain.startsWith("127.0.0.1") || cleanDomain.startsWith("localhost") ? "http" : "https";
  const tomlUrl = `${scheme}://${cleanDomain}/.well-known/stellar.toml`;

  let tomlText = "";
  try {
    const tomlRes = await fetch(tomlUrl, {
      headers: { Accept: "text/plain, text/toml, application/toml, */*" },
      signal: AbortSignal.timeout(8000),
    });
    if (!tomlRes.ok) {
      throw new Error(`Failed to fetch stellar.toml from ${tomlUrl} (HTTP ${tomlRes.status})`);
    }
    tomlText = await tomlRes.text();
  } catch (err: unknown) {
    throw new Error(
      `SEP-1 discovery failed for domain "${cleanDomain}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const parsedToml = parseStellarToml(tomlText);

  const transferServer =
    (parsedToml["TRANSFER_SERVER_SEP0024"] as string) ||
    (parsedToml["TRANSFER_SERVER"] as string);

  if (!transferServer) {
    throw new Error(
      `Anchor "${cleanDomain}" does not advertise TRANSFER_SERVER_SEP0024 or TRANSFER_SERVER in stellar.toml`
    );
  }

  const cleanTransferServer = transferServer.replace(/\/+$/, "");

  // Query /info endpoint for asset rules and fee configs
  let assets: Record<string, Sep24AssetInfo> = {};
  try {
    const infoRes = await fetch(`${cleanTransferServer}/info`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (infoRes.ok) {
      const infoData = (await infoRes.json()) as {
        deposit?: Record<string, Record<string, unknown>>;
        withdraw?: Record<string, Record<string, unknown>>;
      };

      const depositRules = infoData.deposit || {};
      const withdrawRules = infoData.withdraw || {};
      const allCodes = new Set([...Object.keys(depositRules), ...Object.keys(withdrawRules)]);

      for (const code of allCodes) {
        const dep = depositRules[code] || {};
        const wth = withdrawRules[code] || {};

        assets[code] = {
          code,
          deposit: {
            enabled: dep.enabled !== false,
            minAmount: typeof dep.min_amount === "number" ? dep.min_amount : undefined,
            maxAmount: typeof dep.max_amount === "number" ? dep.max_amount : undefined,
            feeFixed: typeof dep.fee_fixed === "number" ? dep.fee_fixed : undefined,
            feePercent: typeof dep.fee_percent === "number" ? dep.fee_percent : undefined,
          },
          withdraw: {
            enabled: wth.enabled !== false,
            minAmount: typeof wth.min_amount === "number" ? wth.min_amount : undefined,
            maxAmount: typeof wth.max_amount === "number" ? wth.max_amount : undefined,
            feeFixed: typeof wth.fee_fixed === "number" ? wth.fee_fixed : undefined,
            feePercent: typeof wth.fee_percent === "number" ? wth.fee_percent : undefined,
          },
        };
      }
    }
  } catch {
    // If /info times out or fails, fallback to currencies in TOML
  }

  // Fallback if /info returned no assets: check [[CURRENCIES]] from TOML
  if (Object.keys(assets).length === 0) {
    const currencies = (parsedToml["CURRENCIES"] as Array<Record<string, unknown>>) || [];
    for (const curr of currencies) {
      const code = (curr.code as string) || (curr.CODE as string);
      if (code) {
        assets[code] = {
          code,
          deposit: { enabled: true },
          withdraw: { enabled: true },
        };
      }
    }
    // Default fallback to USDC and XLM if anchor listed none explicitly
    if (Object.keys(assets).length === 0) {
      assets["USDC"] = { code: "USDC", deposit: { enabled: true }, withdraw: { enabled: true } };
      assets["XLM"] = { code: "XLM", deposit: { enabled: true }, withdraw: { enabled: true } };
    }
  }

  const config: Sep24AnchorConfig = {
    domain: cleanDomain,
    transferServerSep24: cleanTransferServer,
    webAuthEndpoint: parsedToml["WEB_AUTH_ENDPOINT"] as string | undefined,
    signingKey: parsedToml["SIGNING_KEY"] as string | undefined,
    orgName: (parsedToml["ORG_NAME"] || parsedToml["ORGANIZATION_NAME"]) as string | undefined,
    assets,
  };

  anchorCache.set(cacheKey, {
    config,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return config;
}

/**
 * Clear discovery cache (useful for tests).
 */
export function clearAnchorCache(): void {
  anchorCache.clear();
}
