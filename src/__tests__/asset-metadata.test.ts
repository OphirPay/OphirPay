// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseCurrencies,
  resolveAssetMetadata,
  fetchCurrenciesForDomain,
  clearAssetMetadataCache,
  ASSET_METADATA_TIMEOUT_MS,
} from "@/lib/asset-metadata";

// Bypass real DNS/SSRF checks in unit tests — the guard itself has its own
// dedicated test file. Every fetch here is fully mocked.
vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn(async () => true),
}));

const ISSUER = "GAP33XISSUERABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB";
const buildResponse = (body: string): Response =>
  new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/toml" },
  });

describe("parseCurrencies", () => {
  it("parses a SEP-1 CURRENCIES table", () => {
    const toml = `
VERSION="2.0"

[[CURRENCIES]]
code = "USDC"
issuer = "${ISSUER}"
name = "USD Coin"
desc = "Fully backed"

[[CURRENCIES]]
code = "EURT"
issuer = "${ISSUER}"
name = "EUR Tether"
`;
    const rows = parseCurrencies(toml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      code: "USDC",
      issuer: ISSUER,
      name: "USD Coin",
    });
    expect(rows[1]?.name).toBe("EUR Tether");
  });

  it("ignores other tables and inline comments", () => {
    const toml = `
[[CURRENCIES]]
code = "X"  # the code
status = "live"

[[VALIDATORS]]
alias = "ignored"
`;
    const rows = parseCurrencies(toml);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("X");
    expect(rows[0]?.status).toBe("live");
  });

  it("returns an empty array when there are no currencies", () => {
    expect(parseCurrencies('VERSION="2.0"')).toEqual([]);
  });
});

describe("resolveAssetMetadata", () => {
  beforeEach(() => {
    clearAssetMetadataCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves a known issuer to a display name", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/accounts/")) {
        return buildResponse(JSON.stringify({ home_domain: "issuer.example" }));
      }
      return buildResponse(`
[[CURRENCIES]]
code = "USDC"
issuer = "${ISSUER}"
name = "USD Coin"
`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await resolveAssetMetadata("USDC", ISSUER);
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("USD Coin");
    expect(meta?.domain).toBe("issuer.example");
    expect(meta?.code).toBe("USDC");
  });

  it("returns null and makes a single fetch on a cache hit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/accounts/")) {
        return buildResponse(JSON.stringify({ home_domain: "issuer.example" }));
      }
      return buildResponse(`
[[CURRENCIES]]
code = "USDC"
issuer = "${ISSUER}"
name = "USD Coin"

[[CURRENCIES]]
code = "EURT"
issuer = "${ISSUER}"
name = "EUR Tether"
`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // First resolution performs account + TOML fetches.
    const first = await resolveAssetMetadata("USDC", ISSUER);
    expect(first?.name).toBe("USD Coin");
    const callsAfterFirst = fetchMock.mock.calls.length;

    // A second asset from the SAME domain must reuse the cached TOML: only a
    // fresh account lookup, no second stellar.toml fetch.
    const second = await resolveAssetMetadata("EURT", ISSUER);
    expect(second?.name).toBe("EUR Tether");

    const tomlFetches = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("stellar.toml"),
    );
    expect(tomlFetches).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst + 1);
  });

  it("degrades to null on malformed TOML without throwing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/accounts/")) {
        return buildResponse(JSON.stringify({ home_domain: "issuer.example" }));
      }
      // Not a TOML document at all.
      return buildResponse("<html>oops</html>");
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await resolveAssetMetadata("USDC", ISSUER);
    expect(meta).toBeNull();
  });

  it("degrades to null when the issuer has no home domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => buildResponse(JSON.stringify({ id: ISSUER }))),
    );
    const meta = await resolveAssetMetadata("USDC", ISSUER);
    expect(meta).toBeNull();
  });
});

describe("fetchCurrenciesForDomain timeout", () => {
  beforeEach(() => {
    clearAssetMetadataCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("aborts and rejects when the TOML fetch exceeds the timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(
      (await import("@/lib/webhook-url-guard")).isSafeWebhookUrlAtDelivery,
    ).mockResolvedValue(true);

    // A fetch that only resolves once the signal is aborted (well past the
    // documented timeout).
    const fetchMock = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchCurrenciesForDomain("slow.example");

    // Attach a rejection handler BEFORE any timer fires, so the abort rejection
    // is never observed as an unhandled rejection.
    const outcome = result.then(
      () => "resolved",
      () => "rejected",
    );

    // Advance to just under the timeout — still pending.
    await vi.advanceTimersByTimeAsync(ASSET_METADATA_TIMEOUT_MS - 10);
    // Cross the timeout — the internal controller aborts the fetch.
    await vi.advanceTimersByTimeAsync(20);

    expect(await outcome).toBe("rejected");
    await expect(result).rejects.toThrow();
  });
});
