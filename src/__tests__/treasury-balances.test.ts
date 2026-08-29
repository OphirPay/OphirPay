// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseAmountToStroops,
  stroopsToAmountString,
  addStellarAmounts,
  getTreasuryBalances,
  TREASURY_CACHE_TTL_MS,
} from "@/lib/treasury-balances";
import {
  parseAssetIdentifier,
  formatAssetIdentifier,
  areAssetsEqual,
  isValidAssetIssuer,
  getKnownAssets,
  USDC_TESTNET,
  EURC_TESTNET,
} from "@/lib/assets";
import { cacheClear } from "@/lib/api-cache";

// ── Mock Setup ─────────────────────────────────────────────────

const { mockLoadAccount, mockFindMany, mockFindUnique, mockGetAuthContext } = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockGetAuthContext: vi.fn(),
}));

vi.mock("@/lib/stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stellar")>();
  return {
    ...actual,
    getHorizonServer: () => ({
      loadAccount: mockLoadAccount,
    }),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    account: { findMany: mockFindMany },
    user: { findUnique: mockFindUnique },
  },
}));

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: mockGetAuthContext,
}));

import { GET, POST } from "@/app/api/treasury/balances/route";

const VALID_PK_1 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const VALID_PK_2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VALID_PK_3 = "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBS3OIQDNO4STTVU";
const ISSUER_1 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ISSUER_CUSTOM = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

beforeEach(() => {
  vi.clearAllMocks();
  cacheClear();
  mockGetAuthContext.mockResolvedValue({ userId: "user-123", publicKey: VALID_PK_1 });
  mockFindMany.mockResolvedValue([
    { id: "acc-1", publicKey: VALID_PK_1, name: "Treasury Primary" },
    { id: "acc-2", publicKey: VALID_PK_2, name: "Operations Hot Wallet" },
  ]);
  mockFindUnique.mockResolvedValue({ stellarAddress: VALID_PK_1, name: "Test User" });
});

// ── 1. Precise Arithmetic & String Helpers ─────────────────────

describe("Treasury Balance Arithmetic & Formatting", () => {
  it("converts decimal amounts to stroops with exact precision", () => {
    expect(parseAmountToStroops("100.5")).toBe(BigInt(1005000000));
    expect(parseAmountToStroops("0.0000001")).toBe(BigInt(1));
    expect(parseAmountToStroops("123456789.1234567")).toBe(BigInt("1234567891234567"));
    expect(parseAmountToStroops(50.25)).toBe(BigInt(502500000));
    expect(parseAmountToStroops("0")).toBe(BigInt(0));
    expect(parseAmountToStroops("")).toBe(BigInt(0));
    expect(parseAmountToStroops("-10.5")).toBe(BigInt(-105000000));
  });

  it("converts stroops to decimal string without floating point artifacts", () => {
    expect(stroopsToAmountString(BigInt(1005000000))).toBe("100.5");
    expect(stroopsToAmountString(BigInt(1))).toBe("0.0000001");
    expect(stroopsToAmountString(BigInt(0))).toBe("0");
    expect(stroopsToAmountString(BigInt(-105000000))).toBe("-10.5");
  });

  it("safely adds Stellar amounts without float precision loss", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004
    expect(addStellarAmounts("0.1", "0.2")).toBe("0.3");
    expect(addStellarAmounts("1000.5000000", "2000.2500000")).toBe("3000.75");
    expect(addStellarAmounts("0", "42.1234567")).toBe("42.1234567");
  });
});

// ── 2. Asset Identifier & Helper Utilities ─────────────────────

describe("Asset Identifier Utilities", () => {
  it("parses native and custom asset identifiers correctly", () => {
    expect(parseAssetIdentifier("XLM")).toEqual(expect.objectContaining({ code: "XLM", type: "native" }));
    expect(parseAssetIdentifier("native")).toEqual(expect.objectContaining({ code: "XLM", type: "native" }));
    expect(parseAssetIdentifier("USDC")).toEqual(expect.objectContaining({ code: "USDC", issuer: USDC_TESTNET.issuer }));
    expect(parseAssetIdentifier("EURC")).toEqual(expect.objectContaining({ code: "EURC", issuer: EURC_TESTNET.issuer }));

    const custom = parseAssetIdentifier(`COOL:${ISSUER_CUSTOM}`);
    expect(custom).toEqual({
      code: "COOL",
      issuer: ISSUER_CUSTOM,
      type: "credit_alphanum4",
      displayName: "COOL",
      decimals: 7,
    });

    const longCode = parseAssetIdentifier(`MYLONGTOKEN:${ISSUER_CUSTOM}`);
    expect(longCode?.type).toBe("credit_alphanum12");

    expect(parseAssetIdentifier("")).toBeNull();
    expect(parseAssetIdentifier("INVALID:TOO_SHORT_ISSUER")).toBeNull();
  });

  it("formats asset identifiers properly", () => {
    expect(formatAssetIdentifier("XLM")).toBe("XLM");
    expect(formatAssetIdentifier("USDC", ISSUER_1)).toBe(`USDC:${ISSUER_1}`);
  });

  it("compares assets correctly with areAssetsEqual", () => {
    expect(areAssetsEqual({ code: "XLM" }, { code: "XLM", type: "native" })).toBe(true);
    expect(areAssetsEqual({ code: "USDC", issuer: ISSUER_1 }, { code: "USDC", issuer: ISSUER_1 })).toBe(true);
    expect(areAssetsEqual({ code: "USDC", issuer: ISSUER_1 }, { code: "USDC", issuer: ISSUER_CUSTOM })).toBe(false);
  });
});

// ── 3. Multi-Asset Balance Aggregation Service ─────────────────

describe("getTreasuryBalances Service", () => {
  it("aggregates balances across multiple wallets with trustlines", async () => {
    mockLoadAccount.mockImplementation(async (pk: string) => {
      if (pk === VALID_PK_1) {
        return {
          balances: [
            { asset_type: "native", balance: "1500.5000000" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: ISSUER_1,
              balance: "250.0000000",
              limit: "100000.0000000",
              is_authorized: true,
            },
          ],
        };
      }
      if (pk === VALID_PK_2) {
        return {
          balances: [
            { asset_type: "native", balance: "500.2500000" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: ISSUER_1,
              balance: "750.0000000",
              limit: "50000.0000000",
              is_authorized: true,
            },
            {
              asset_type: "credit_alphanum4",
              asset_code: "COOL",
              asset_issuer: ISSUER_CUSTOM,
              balance: "100.0000000",
              limit: "1000.0000000",
              is_authorized: true,
            },
          ],
        };
      }
      throw { response: { status: 404 } };
    });

    const result = await getTreasuryBalances([
      { publicKey: VALID_PK_1, name: "Wallet 1" },
      { publicKey: VALID_PK_2, name: "Wallet 2" },
    ]);

    expect(result.summary.totalWallets).toBe(2);
    expect(result.summary.activeWallets).toBe(2);
    expect(result.summary.unfundedWallets).toBe(0);
    expect(result.summary.xlmTotal).toBe("2000.75");

    // Check XLM aggregation
    const xlmAsset = result.assets.find((a) => a.assetCode === "XLM");
    expect(xlmAsset).toBeDefined();
    expect(xlmAsset?.totalBalance).toBe("2000.75");
    expect(xlmAsset?.walletsHoldingCount).toBe(2);
    expect(xlmAsset?.untrustedWalletsCount).toBe(0);

    // Check USDC aggregation
    const usdcAsset = result.assets.find((a) => a.assetCode === "USDC");
    expect(usdcAsset).toBeDefined();
    expect(usdcAsset?.totalBalance).toBe("1000");
    expect(usdcAsset?.walletsHoldingCount).toBe(2);
    expect(usdcAsset?.untrustedWalletsCount).toBe(0);

    // Check discovered COOL token aggregation
    const coolAsset = result.assets.find((a) => a.assetCode === "COOL");
    expect(coolAsset).toBeDefined();
    expect(coolAsset?.totalBalance).toBe("100");
    expect(coolAsset?.walletsHoldingCount).toBe(1);
    expect(coolAsset?.untrustedWalletsCount).toBe(1); // Wallet 1 has no trustline for COOL

    // Check Wallet 1 breakdown for COOL (untrusted)
    const wallet1Breakdown = coolAsset?.walletBreakdown.find((w) => w.publicKey === VALID_PK_1);
    expect(wallet1Breakdown?.hasTrustline).toBe(false);
    expect(wallet1Breakdown?.balance).toBe("0");
    expect(wallet1Breakdown?.error).toContain("No trustline");
  });

  it("contains errors for untrusted assets and unfunded accounts", async () => {
    mockLoadAccount.mockImplementation(async (pk: string) => {
      if (pk === VALID_PK_1) {
        return {
          balances: [{ asset_type: "native", balance: "100.0000000" }],
        };
      }
      if (pk === VALID_PK_2) {
        // 404 Unfunded account
        const notFound = new Error("Account not found");
        (notFound as any).response = { status: 404 };
        throw notFound;
      }
      if (pk === VALID_PK_3) {
        // Horizon RPC temporary error
        throw new Error("Network connection reset");
      }
      throw new Error("Unknown error");
    });

    const result = await getTreasuryBalances([
      { publicKey: VALID_PK_1, name: "Funded Wallet" },
      { publicKey: VALID_PK_2, name: "Unfunded Wallet" },
      { publicKey: VALID_PK_3, name: "Faulty Wallet" },
    ]);

    expect(result.summary.totalWallets).toBe(3);
    expect(result.summary.activeWallets).toBe(1);
    expect(result.summary.unfundedWallets).toBe(2);

    const fundedWallet = result.wallets.find((w) => w.publicKey === VALID_PK_1);
    expect(fundedWallet?.isFunded).toBe(true);
    expect(fundedWallet?.error).toBeNull();

    const unfundedWallet = result.wallets.find((w) => w.publicKey === VALID_PK_2);
    expect(unfundedWallet?.isFunded).toBe(false);
    expect(unfundedWallet?.error).toBeNull(); // 404 is handled gracefully

    const faultyWallet = result.wallets.find((w) => w.publicKey === VALID_PK_3);
    expect(faultyWallet?.isFunded).toBe(false);
    expect(faultyWallet?.error).toBe("Network connection reset");

    // Total XLM still calculates cleanly from available wallets
    expect(result.summary.xlmTotal).toBe("100");
  });

  it("supports caching with short TTL and on-demand refresh", async () => {
    let callCount = 0;
    mockLoadAccount.mockImplementation(async () => {
      callCount++;
      return {
        balances: [{ asset_type: "native", balance: `${callCount * 100}.0000000` }],
      };
    });

    const wallets = [{ publicKey: VALID_PK_1, name: "Primary" }];

    // 1st request -> Miss (fetches on-chain)
    const first = await getTreasuryBalances(wallets);
    expect(first.cached).toBe(false);
    expect(first.summary.xlmTotal).toBe("100");
    expect(callCount).toBe(1);

    // 2nd request -> Hit (returns cached)
    const second = await getTreasuryBalances(wallets);
    expect(second.cached).toBe(true);
    expect(second.summary.xlmTotal).toBe("100");
    expect(callCount).toBe(1);

    // 3rd request with refresh=true -> Bypass cache & update
    const third = await getTreasuryBalances(wallets, { refresh: true });
    expect(third.cached).toBe(false);
    expect(third.summary.xlmTotal).toBe("200");
    expect(callCount).toBe(2);
  });
});

// ── 4. API Route Handlers (GET & POST) ─────────────────────────

describe("API Route: /api/treasury/balances", () => {
  it("GET returns multi-asset balances for authenticated user linked accounts", async () => {
    mockLoadAccount.mockImplementation(async (pk: string) => {
      if (pk === VALID_PK_1) {
        return {
          balances: [
            { asset_type: "native", balance: "1000.0000000" },
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: ISSUER_1,
              balance: "500.0000000",
              limit: "10000.0000000",
            },
          ],
        };
      }
      return {
        balances: [{ asset_type: "native", balance: "500.0000000" }],
      };
    });

    const req = new Request("http://localhost/api/treasury/balances");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary.totalWallets).toBe(2);
    expect(body.data.summary.xlmTotal).toBe("1500");
    expect(res.headers.get("Cache-Control")).toContain("public, max-age=30");
  });

  it("GET supports query parameter ?wallets=... for custom or unauthenticated queries", async () => {
    mockGetAuthContext.mockResolvedValue(null); // Unauthenticated
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "350.0000000" }],
    });

    const req = new Request(`http://localhost/api/treasury/balances?wallets=${VALID_PK_1},${VALID_PK_2}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary.totalWallets).toBe(2);
    expect(body.data.summary.xlmTotal).toBe("700");
  });

  it("GET returns 401 when unauthenticated and no wallets provided", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const req = new Request("http://localhost/api/treasury/balances");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("GET returns 400 when invalid wallet address is provided", async () => {
    mockGetAuthContext.mockResolvedValue(null);

    const req = new Request("http://localhost/api/treasury/balances?wallets=INVALID_ADDRESS_123");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain("Invalid Stellar public key");
  });

  it("GET ?refresh=true returns no-cache headers and refreshed payload", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "100.0000000" }],
    });

    const req = new Request(`http://localhost/api/treasury/balances?wallets=${VALID_PK_1}&refresh=true`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    const body = await res.json();
    expect(body.data.cached).toBe(false);
    expect(body.data.refreshedAt).toBeDefined();
  });

  it("POST accepts JSON body with wallets, assets, and refresh flags", async () => {
    mockGetAuthContext.mockResolvedValue(null);
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "200.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: ISSUER_1,
          balance: "100.0000000",
        },
      ],
    });

    const req = new Request("http://localhost/api/treasury/balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallets: [
          { publicKey: VALID_PK_1, name: "Cold Storage" },
          VALID_PK_2,
        ],
        assets: ["XLM", `USDC:${ISSUER_1}`],
        refresh: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary.totalWallets).toBe(2);
    expect(body.data.assets.length).toBeGreaterThanOrEqual(2);
  });
});
