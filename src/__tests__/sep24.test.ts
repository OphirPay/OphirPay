// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchAnchorMetadata,
  initiateInteractiveFlow,
  fetchAnchorTransaction,
  pollAnchorTransaction,
  mapAnchorStatus,
  isTerminalStatus,
  getAnchorDomain,
  getAnchorFiatCurrency,
  AnchorError,
  AnchorPollTimeoutError,
  resetAnchorCache,
  type AnchorToml,
  type AnchorTransaction,
  type Sep24Status,
} from "@/lib/sep24";

const ANCHOR_TOML: AnchorToml = {
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  TRANSFER_SERVER_SEP0024: "https://anchor.example.com/sep24/",
  WEB_AUTH_ENDPOINT: "https://anchor.example.com/auth",
  SIGNING_KEY: "GABCDEF",
  CURRENCIES: [
    { code: "USDC", issuer: "GISSUER", name: "USD Coin", anchor_asset_type: "crypto" },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A clock the injected `sleep` advances, so polling is instant. */
function manualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetAnchorCache();
  delete process.env.NEXT_PUBLIC_ANCHOR_DOMAIN;
  delete process.env.NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY;
  delete process.env.ANCHOR_METADATA_TTL_MS;
  delete process.env.ANCHOR_POLL_INTERVAL_MS;
  delete process.env.ANCHOR_POLL_TIMEOUT_MS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("anchor configuration", () => {
  it("defaults to the testnet anchor and USD", () => {
    expect(getAnchorDomain()).toBe("testanchor.stellar.org");
    expect(getAnchorFiatCurrency()).toBe("USD");
  });

  it("honours overrides and strips scheme/trailing slash", () => {
    process.env.NEXT_PUBLIC_ANCHOR_DOMAIN = "https://anchor.example.com/";
    process.env.NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY = "eur";
    expect(getAnchorDomain()).toBe("anchor.example.com");
    expect(getAnchorFiatCurrency()).toBe("EUR");
  });
});

describe("fetchAnchorMetadata", () => {
  it("discovers endpoints and currencies from the SEP-1 TOML", async () => {
    const meta = await fetchAnchorMetadata("anchor.example.com", {
      resolveToml: vi.fn(async () => ANCHOR_TOML),
    });
    expect(meta.transferServer).toBe("https://anchor.example.com/sep24");
    expect(meta.webAuthEndpoint).toBe("https://anchor.example.com/auth");
    expect(meta.networkPassphrase).toBe("Test SDF Network ; September 2015");
    expect(meta.currencies[0].code).toBe("USDC");
    expect(meta.cached).toBe(false);
  });

  it("falls back to the legacy TRANSFER_SERVER key", async () => {
    const meta = await fetchAnchorMetadata("anchor.example.com", {
      resolveToml: vi.fn(async () => ({
        TRANSFER_SERVER: "https://anchor.example.com/legacy",
      })),
    });
    expect(meta.transferServer).toBe("https://anchor.example.com/legacy");
  });

  it("caches per domain and flags the cache hit", async () => {
    const resolveToml = vi.fn(async () => ANCHOR_TOML);
    await fetchAnchorMetadata("anchor.example.com", { resolveToml, now: () => 1000 });
    const second = await fetchAnchorMetadata("anchor.example.com", {
      resolveToml,
      now: () => 2000,
    });
    expect(resolveToml).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  it("refetches after the metadata TTL elapses", async () => {
    process.env.ANCHOR_METADATA_TTL_MS = "1000";
    const resolveToml = vi.fn(async () => ANCHOR_TOML);
    await fetchAnchorMetadata("anchor.example.com", { resolveToml, now: () => 1000 });
    await fetchAnchorMetadata("anchor.example.com", { resolveToml, now: () => 5000 });
    expect(resolveToml).toHaveBeenCalledTimes(2);
  });

  it("throws when the TOML cannot be loaded", async () => {
    await expect(
      fetchAnchorMetadata("anchor.example.com", {
        resolveToml: vi.fn(async () => {
          throw new Error("network down");
        }),
      })
    ).rejects.toBeInstanceOf(AnchorError);
  });

  it("throws when no SEP-24 transfer server is advertised", async () => {
    await expect(
      fetchAnchorMetadata("anchor.example.com", {
        resolveToml: vi.fn(async () => ({ CURRENCIES: [] })),
      })
    ).rejects.toThrow(/does not advertise a SEP-24 transfer server/);
  });
});

describe("initiateInteractiveFlow", () => {
  it("POSTs form-encoded fields and returns the interactive URL + id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ type: "interactive_customer_info_needed", url: "https://anchor.example.com/kyc?id=1", id: "tx-1" })
    );

    const flow = await initiateInteractiveFlow({
      kind: "deposit",
      assetCode: "USDC",
      account: "GACCOUNT",
      amount: "100",
      transferServer: "https://anchor.example.com/sep24",
      fetchImpl,
    });

    expect(flow).toEqual({
      url: "https://anchor.example.com/kyc?id=1",
      id: "tx-1",
      kind: "deposit",
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://anchor.example.com/sep24/transactions/deposit/interactive");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("asset_code=USDC");
    expect(String(init.body)).toContain("account=GACCOUNT");
    expect(String(init.body)).toContain("amount=100");
  });

  it("attaches a SEP-10 bearer token when provided", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ url: "u", id: "1" }));
    await initiateInteractiveFlow({
      kind: "withdrawal",
      assetCode: "USDC",
      account: "GACCOUNT",
      jwt: "token-123",
      transferServer: "https://anchor.example.com/sep24",
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("surfaces the anchor's SEP-24 error body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "asset_code USDC is not supported" }, 400)
    );

    await expect(
      initiateInteractiveFlow({
        kind: "deposit",
        assetCode: "USDC",
        account: "GACCOUNT",
        transferServer: "https://anchor.example.com/sep24",
        fetchImpl,
      })
    ).rejects.toThrow(/not supported/);
  });

  it("rejects an incomplete interactive response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "only-id" }));
    await expect(
      initiateInteractiveFlow({
        kind: "deposit",
        assetCode: "USDC",
        account: "GACCOUNT",
        transferServer: "https://anchor.example.com/sep24",
        fetchImpl,
      })
    ).rejects.toBeInstanceOf(AnchorError);
  });
});

describe("fetchAnchorTransaction", () => {
  it("unwraps the transaction record", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ transaction: { id: "tx-1", status: "pending_anchor" } })
    );
    const tx = await fetchAnchorTransaction({
      transferServer: "https://anchor.example.com/sep24",
      id: "tx-1",
      fetchImpl,
    });
    expect(tx.status).toBe("pending_anchor");
  });

  it("throws when the anchor returns no transaction", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      fetchAnchorTransaction({
        transferServer: "https://anchor.example.com/sep24",
        id: "tx-1",
        fetchImpl,
      })
    ).rejects.toBeInstanceOf(AnchorError);
  });
});

describe("status mapping", () => {
  it("classifies terminal statuses", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("pending_anchor")).toBe(false);
    expect(isTerminalStatus("expired")).toBe(true);
  });

  it("maps SEP-24 statuses onto app flow states", () => {
    expect(mapAnchorStatus("completed")).toBe("completed");
    expect(mapAnchorStatus("refunded")).toBe("refunded");
    expect(mapAnchorStatus("error")).toBe("failed");
    expect(mapAnchorStatus("expired")).toBe("failed");
    expect(mapAnchorStatus("pending_user_transfer_start")).toBe("pending");
  });
});

describe("pollAnchorTransaction", () => {
  function sequenceFetch(statuses: Sep24Status[]) {
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      const status = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      return jsonResponse({ transaction: { id: "tx-1", status } });
    });
    return fetchImpl;
  }

  it("polls until completion and reports each update", async () => {
    const clock = manualClock();
    const fetchImpl = sequenceFetch(["pending_anchor", "pending_stellar", "completed"]);
    const updates: AnchorTransaction[] = [];

    const tx = await pollAnchorTransaction(
      {
        transferServer: "https://anchor.example.com/sep24",
        id: "tx-1",
        intervalMs: 1000,
        timeoutMs: 60_000,
        onUpdate: (t) => updates.push(t),
        fetchImpl,
      },
      { now: clock.now, sleep: clock.sleep }
    );

    expect(tx.status).toBe("completed");
    expect(mapAnchorStatus(tx.status)).toBe("completed");
    expect(updates).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("propagates a refund as a terminal result", async () => {
    const clock = manualClock();
    const tx = await pollAnchorTransaction(
      {
        transferServer: "https://anchor.example.com/sep24",
        id: "tx-1",
        intervalMs: 1000,
        timeoutMs: 60_000,
        fetchImpl: sequenceFetch(["pending_anchor", "refunded"]),
      },
      { now: clock.now, sleep: clock.sleep }
    );
    expect(mapAnchorStatus(tx.status)).toBe("refunded");
  });

  it("times out when the transaction never terminates", async () => {
    const clock = manualClock();
    await expect(
      pollAnchorTransaction(
        {
          transferServer: "https://anchor.example.com/sep24",
          id: "tx-1",
          intervalMs: 1000,
          timeoutMs: 3000,
          fetchImpl: sequenceFetch(["pending_anchor"]),
        },
        { now: clock.now, sleep: clock.sleep }
      )
    ).rejects.toBeInstanceOf(AnchorPollTimeoutError);
  });

  it("aborts when the caller's signal fires", async () => {
    const clock = manualClock();
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollAnchorTransaction(
        {
          transferServer: "https://anchor.example.com/sep24",
          id: "tx-1",
          signal: controller.signal,
          fetchImpl: sequenceFetch(["pending_anchor"]),
        },
        { now: clock.now, sleep: clock.sleep }
      )
    ).rejects.toThrow(/aborted/i);
  });
});
