// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  resolveAssetMetadata,
  fetchDomainToml,
  fetchIssuerHomeDomain,
  parseSep1Toml,
  clearAssetMetadataCache,
  setCachedDomainMetadata,
  getDomainCacheSize,
  MAX_TOML_SIZE_BYTES,
  USDC_TESTNET,
  USDC_MAINNET,
  XLM_ASSET,
} from "@/lib/assets";
import { GET as getAssetMetadataRoute } from "@/app/api/assets/metadata/route";

const originalFetch = global.fetch;

describe("SEP-1 Asset Metadata Discovery and Caching", () => {
  const MOCK_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const MOCK_ISSUER_2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const MOCK_CUSTOM_ISSUER = "GBNZILSTVQZ4RAGETTXKNGTVEQNP382A6C2AQ8M77MYGQZ8G2N9MABCD";

  const VALID_TOML = `
NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015"

[DOCUMENTATION]
ORG_NAME = "Aquarius Foundation"
ORG_URL = "https://aqua.network"

[[CURRENCIES]]
code = "AQUA"
issuer = "${MOCK_CUSTOM_ISSUER}"
name = "Aquarius"
desc = "Aquarius liquidity token"
display_decimals = 7

[[CURRENCIES]]
code = "ICE"
issuer = "${MOCK_CUSTOM_ISSUER}"
name = "Ice Token"
display_decimals = 7
`;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAssetMetadataCache();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearAssetMetadataCache();
  });

  describe("parseSep1Toml", () => {
    it("parses currencies and documentation correctly", () => {
      const parsed = parseSep1Toml(VALID_TOML);
      expect(parsed.DOCUMENTATION?.ORG_NAME).toBe("Aquarius Foundation");
      expect(parsed.CURRENCIES).toHaveLength(2);
      expect(parsed.CURRENCIES![0].code).toBe("AQUA");
      expect(parsed.CURRENCIES![0].name).toBe("Aquarius");
      expect(parsed.CURRENCIES![0].display_decimals).toBe(7);
      expect(parsed.CURRENCIES![1].code).toBe("ICE");
    });

    it("gracefully handles empty and malformed content without throwing", () => {
      const parsed = parseSep1Toml("this is @@ invalid [[ content }}}");
      expect(parsed.CURRENCIES).toEqual([]);
    });
  });

  describe("Known Assets", () => {
    it("returns native XLM without fetching", async () => {
      const res = await resolveAssetMetadata("XLM");
      expect(res.resolved).toBe(true);
      expect(res.displayName).toBe("Stellar Lumens");
      expect(res.type).toBe("native");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns USDC Testnet immediately when issuer matches", async () => {
      const res = await resolveAssetMetadata("USDC", USDC_TESTNET.issuer);
      expect(res.resolved).toBe(true);
      expect(res.displayName).toBe("USDC (Testnet)");
      expect(res.name).toBe("USD Coin");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns USDC Mainnet immediately when issuer matches", async () => {
      const res = await resolveAssetMetadata("USDC", USDC_MAINNET.issuer);
      expect(res.resolved).toBe(true);
      expect(res.displayName).toBe("USDC");
      expect(res.name).toBe("USD Coin");
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("Resolution and Domain Caching", () => {
    it("resolves custom asset display name and metadata via issuer home_domain", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/accounts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ home_domain: "aqua.network" }),
          } as Response;
        }
        if (urlStr.includes("stellar.toml")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": String(VALID_TOML.length) }),
            text: async () => VALID_TOML,
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const res = await resolveAssetMetadata("AQUA", MOCK_CUSTOM_ISSUER);
      expect(res.resolved).toBe(true);
      expect(res.displayName).toBe("Aquarius");
      expect(res.name).toBe("Aquarius");
      expect(res.orgName).toBe("Aquarius Foundation");
      expect(res.domain).toBe("aqua.network");
    });

    it("hits domain cache on subsequent lookups for assets from the same issuer", async () => {
      let tomlFetchCount = 0;
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/accounts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ home_domain: "aqua.network" }),
          } as Response;
        }
        if (urlStr.includes("stellar.toml")) {
          tomlFetchCount += 1;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": String(VALID_TOML.length) }),
            text: async () => VALID_TOML,
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      // First lookup: AQUA
      const first = await resolveAssetMetadata("AQUA", MOCK_CUSTOM_ISSUER);
      expect(first.displayName).toBe("Aquarius");
      expect(tomlFetchCount).toBe(1);

      // Second lookup: ICE from same issuer / domain
      const second = await resolveAssetMetadata("ICE", MOCK_CUSTOM_ISSUER);
      expect(second.displayName).toBe("Ice Token");
      // Cached per domain! TOML was NOT fetched a second time
      expect(tomlFetchCount).toBe(1);
      expect(getDomainCacheSize()).toBe(1);
    });

    it("resolves via direct domain option without querying Horizon", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("stellar.toml")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => VALID_TOML,
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });

      const res = await resolveAssetMetadata("AQUA", undefined, { domain: "aqua.network" });
      expect(res.resolved).toBe(true);
      expect(res.displayName).toBe("Aquarius");
      // Horizon /accounts/ was not called
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    });
  });

  describe("Graceful Degradation", () => {
    it("degrades to raw code and issuer when issuer has no home_domain", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: MOCK_CUSTOM_ISSUER }), // No home_domain
      } as Response);

      const res = await resolveAssetMetadata("CUSTOM", MOCK_CUSTOM_ISSUER);
      expect(res.resolved).toBe(false);
      expect(res.displayName).toBe("CUSTOM");
      expect(res.code).toBe("CUSTOM");
      expect(res.issuer).toBe(MOCK_CUSTOM_ISSUER);
    });

    it("degrades to raw code when Horizon account lookup fails", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      const res = await resolveAssetMetadata("MYTOKEN", MOCK_CUSTOM_ISSUER);
      expect(res.resolved).toBe(false);
      expect(res.displayName).toBe("MYTOKEN");
      expect(res.issuer).toBe(MOCK_CUSTOM_ISSUER);
    });

    it("degrades gracefully when TOML contains malformed syntax", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/accounts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ home_domain: "broken.org" }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => "CORRUPT DATA [[ INVALID TOML",
        } as Response;
      });

      const res = await resolveAssetMetadata("FOO", MOCK_CUSTOM_ISSUER);
      expect(res.resolved).toBe(false);
      expect(res.displayName).toBe("FOO");
    });

    it("degrades gracefully when TOML fetch times out", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/accounts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ home_domain: "slow.org" }),
          } as Response;
        }
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      });

      const res = await resolveAssetMetadata("SLOW", MOCK_CUSTOM_ISSUER, { timeoutMs: 50 });
      expect(res.resolved).toBe(false);
      expect(res.displayName).toBe("SLOW");
    });

    it("rejects TOML files exceeding maximum size limit", async () => {
      const hugeToml = "A".repeat(MAX_TOML_SIZE_BYTES + 500);
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/accounts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ home_domain: "huge.org" }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": String(hugeToml.length) }),
          text: async () => hugeToml,
        } as Response;
      });

      const res = await resolveAssetMetadata("BIG", MOCK_CUSTOM_ISSUER);
      expect(res.resolved).toBe(false);
      expect(res.displayName).toBe("BIG");
    });

    it("blocks private / loopback IP addresses via SSRF guard", async () => {
      vi.mocked(global.fetch).mockImplementation(async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/accounts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ home_domain: "127.0.0.1" }),
          } as Response;
        }
        return { ok: true, text: async () => VALID_TOML } as Response;
      });

      const res = await resolveAssetMetadata("HACK", MOCK_CUSTOM_ISSUER);
      expect(res.resolved).toBe(false);
      expect(res.displayName).toBe("HACK");
      // The TOML fetch should never have been attempted on 127.0.0.1
      const calledUrls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]));
      expect(calledUrls.some((u) => u.includes("127.0.0.1/.well-known"))).toBe(false);
    });
  });

  describe("API Route: /api/assets/metadata", () => {
    it("returns 200 with resolved metadata for a valid query", async () => {
      setCachedDomainMetadata("aqua.network", {
        currencies: [
          {
            code: "AQUA",
            issuer: MOCK_CUSTOM_ISSUER,
            name: "Aquarius",
          },
        ],
        orgName: "Aquarius Foundation",
      });

      const req = new Request(
        `http://localhost/api/assets/metadata?code=AQUA&domain=aqua.network&issuer=${MOCK_CUSTOM_ISSUER}`
      );
      const res = await getAssetMetadataRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.displayName).toBe("Aquarius");
      expect(json.data.resolved).toBe(true);
    });

    it("returns 400 when asset code is missing", async () => {
      const req = new Request("http://localhost/api/assets/metadata");
      const res = await getAssetMetadataRoute(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });
});
