// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateExchangeRate,
  calculateDestMin,
  createAsset,
  findStrictSendPath,
  buildPathPaymentStrictSendTx,
  buildPaymentTx,
  NETWORK_PASSPHRASE,
  getHorizonServer,
} from "@/lib/stellar";
import {
  TransactionBuilder,
  Horizon,
} from "@stellar/stellar-sdk";

// Mock source account for transaction building
const mockAccount = new Horizon.AccountResponse({
  id: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  account_id: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  sequence: "123456",
  subentry_count: 1,
  inflation_destination: "",
  home_domain: "",
  last_modified_ledger: 100,
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
  balances: [],
  signers: [],
  data: {},
  paging_token: "123456",
} as unknown as Horizon.ServerApi.AccountRecord);

describe("Stellar Path Payment Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateExchangeRate", () => {
    it("calculates correct exchange rate with numeric and string values", () => {
      // 10 XLM -> 1.25 USDC
      expect(calculateExchangeRate(10, 1.25)).toBe(0.125);
      expect(calculateExchangeRate("10", "1.25")).toBe(0.125);

      // 100 USDC -> 800 XLM
      expect(calculateExchangeRate(100, 800)).toBe(8);
      expect(calculateExchangeRate("100", "800")).toBe(8);
    });

    it("returns 0 for zero or invalid inputs", () => {
      expect(calculateExchangeRate(0, 100)).toBe(0);
      expect(calculateExchangeRate(-5, 100)).toBe(0);
      expect(calculateExchangeRate("invalid", "100")).toBe(0);
      expect(calculateExchangeRate("100", "invalid")).toBe(0);
    });
  });

  describe("calculateDestMin", () => {
    it("applies default 1% slippage tolerance", () => {
      expect(calculateDestMin(100)).toBe("99.0000000");
      expect(calculateDestMin("50.5")).toBe((50.5 * 0.99).toFixed(7));
    });

    it("applies custom slippage tolerance", () => {
      // 5% slippage
      expect(calculateDestMin(100, 0.05)).toBe("95.0000000");
      // 0.5% slippage
      expect(calculateDestMin("200", 0.005)).toBe((200 * 0.995).toFixed(7));
    });

    it("handles zero or invalid values gracefully", () => {
      expect(calculateDestMin(0)).toBe("0");
      expect(calculateDestMin(-10)).toBe("0");
      expect(calculateDestMin("invalid")).toBe("0");
    });
  });

  describe("createAsset", () => {
    it("creates native asset for XLM or missing issuer", () => {
      const native1 = createAsset("XLM");
      expect(native1.isNative()).toBe(true);

      const native2 = createAsset("native");
      expect(native2.isNative()).toBe(true);

      const native3 = createAsset(undefined);
      expect(native3.isNative()).toBe(true);

      const native4 = createAsset("USDC"); // No issuer
      expect(native4.isNative()).toBe(true);
    });

    it("creates issued asset when code and issuer are provided", () => {
      const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const usdc = createAsset("USDC", issuer);

      expect(usdc.isNative()).toBe(false);
      expect(usdc.getCode()).toBe("USDC");
      expect(usdc.getIssuer()).toBe(issuer);
    });
  });

  describe("findStrictSendPath", () => {
    it("returns null for non-positive send amounts", async () => {
      const result = await findStrictSendPath({
        sourceAssetCode: "XLM",
        sendAmount: "0",
        destAssetCode: "USDC",
      });
      expect(result).toBeNull();
    });

    it("discovers best strict send path from Horizon", async () => {
      const issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const server = getHorizonServer();

      // Mock strictSendPaths call
      const mockCall = vi.fn().mockResolvedValue({
        records: [
          {
            source_asset_type: "native",
            source_amount: "10.0000000",
            destination_asset_type: "credit_alphanum4",
            destination_asset_code: "USDC",
            destination_asset_issuer: issuer,
            destination_amount: "1.2000000",
            path: [],
          },
          {
            source_asset_type: "native",
            source_amount: "10.0000000",
            destination_asset_type: "credit_alphanum4",
            destination_asset_code: "USDC",
            destination_asset_issuer: issuer,
            destination_amount: "1.2500000", // Best rate
            path: [],
          },
        ],
      });

      vi.spyOn(server, "strictSendPaths").mockReturnValue({
        call: mockCall,
      } as unknown as ReturnType<typeof server.strictSendPaths>);

      const estimate = await findStrictSendPath({
        sourceAssetCode: "XLM",
        sendAmount: "10",
        destAssetCode: "USDC",
        destAssetIssuer: issuer,
      });

      expect(estimate).not.toBeNull();
      expect(estimate?.destinationAmount).toBe("1.2500000");
      expect(estimate?.exchangeRate).toBe(0.125);
      expect(estimate?.destMin).toBe((1.25 * 0.99).toFixed(7));
      expect(estimate?.sourceAsset.code).toBe("XLM");
      expect(estimate?.destAsset.code).toBe("USDC");
    });

    it("returns null when no paths are found", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "strictSendPaths").mockReturnValue({
        call: vi.fn().mockResolvedValue({ records: [] }),
      } as unknown as ReturnType<typeof server.strictSendPaths>);

      const estimate = await findStrictSendPath({
        sourceAssetCode: "XLM",
        sendAmount: "50",
        destAssetCode: "USDC",
      });

      expect(estimate).toBeNull();
    });
  });

  describe("buildPathPaymentStrictSendTx", () => {
    it("builds a valid PathPaymentStrictSend transaction XDR", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      vi.spyOn(server, "fetchBaseFee").mockResolvedValue(100);

      const sourcePublicKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const destination = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
      const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

      const res = await buildPathPaymentStrictSendTx({
        sourcePublicKey,
        destination,
        sendAmount: "25.0000000",
        destMin: "3.1000000",
        sourceAssetCode: "XLM",
        destAssetCode: "USDC",
        destAssetIssuer: usdcIssuer,
        memo: "Cross asset send",
      });

      expect(res.xdr).toBeTruthy();
      expect(res.sourceAccount).toBe(mockAccount);

      // Verify built transaction operations
      const tx = TransactionBuilder.fromXDR(res.xdr, NETWORK_PASSPHRASE);
      expect(tx.operations).toHaveLength(1);

      const op = tx.operations[0];
      expect(op.type).toBe("pathPaymentStrictSend");

      if (op.type === "pathPaymentStrictSend") {
        expect(op.sendAsset.isNative()).toBe(true);
        expect(op.sendAmount).toBe("25.0000000");
        expect(op.destination).toBe(destination);
        expect(op.destAsset.getCode()).toBe("USDC");
        expect(op.destAsset.getIssuer()).toBe(usdcIssuer);
        expect(op.destMin).toBe("3.1000000");
      }
    });
  });

  describe("buildPaymentTx cross-asset delegation", () => {
    it("delegates to pathPaymentStrictSend when destination asset differs from source asset", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      vi.spyOn(server, "fetchBaseFee").mockResolvedValue(100);

      const sourcePublicKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const destination = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
      const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

      const res = await buildPaymentTx({
        sourcePublicKey,
        destination,
        amount: "50.0000000",
        assetCode: "XLM",
        destAssetCode: "USDC",
        destAssetIssuer: usdcIssuer,
        destMin: "6.2000000",
      });

      const tx = TransactionBuilder.fromXDR(res.xdr, NETWORK_PASSPHRASE);
      expect(tx.operations[0].type).toBe("pathPaymentStrictSend");
    });

    it("uses standard payment when source and destination assets are identical", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "loadAccount").mockResolvedValue(mockAccount);
      vi.spyOn(server, "fetchBaseFee").mockResolvedValue(100);

      const sourcePublicKey = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const destination = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";

      const res = await buildPaymentTx({
        sourcePublicKey,
        destination,
        amount: "50.0000000",
        assetCode: "XLM",
        destAssetCode: "XLM",
      });

      const tx = TransactionBuilder.fromXDR(res.xdr, NETWORK_PASSPHRASE);
      expect(tx.operations[0].type).toBe("payment");
    });
  });
});
