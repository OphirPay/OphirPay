// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkTrustline,
  classifyTrustlineStatus,
  createChangeTrustTransaction,
  buildTrustlineTransaction,
  canAffordTrustlineReserve,
  wouldExceedTrustlineLimit,
  getTrustlineStatusMessage,
  TRUSTLINE_ONE_SENTENCE_EXPLANATION,
  BASE_RESERVE_PER_TRUSTLINE_XLM,
} from "@/lib/trustline";
import { TrustlineSimulator } from "@/lib/trustline-simulator";
import { Account, Keypair, Networks } from "@stellar/stellar-sdk";
import * as stellarLib from "@/lib/stellar";

describe("Trustline Logic & Helpers", () => {
  const testAccount = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  it("exports correct one-sentence explanation and base reserve constant", () => {
    expect(TRUSTLINE_ONE_SENTENCE_EXPLANATION).toBe(
      "A trustline is an explicit agreement on the Stellar network that enables your account to receive and hold a specific non-native asset from an issuer."
    );
    expect(BASE_RESERVE_PER_TRUSTLINE_XLM).toBe("0.5");
  });

  describe("getTrustlineStatusMessage", () => {
    it("returns accurate messages for all states", () => {
      expect(getTrustlineStatusMessage("authorized", "USDC")).toContain(
        "Trustline active and authorized"
      );
      expect(getTrustlineStatusMessage("authorized", "USDC")).toContain(
        "ready to receive payments in USDC"
      );

      expect(getTrustlineStatusMessage("unauthorized", "USDC")).toContain(
        "Trustline unauthorized"
      );
      expect(getTrustlineStatusMessage("unauthorized", "USDC")).toContain(
        "issuer requires explicit authorization"
      );

      expect(getTrustlineStatusMessage("frozen", "USDC")).toContain(
        "Trustline frozen"
      );
      expect(getTrustlineStatusMessage("frozen", "USDC")).toContain(
        "issuer has temporarily frozen this trustline"
      );

      expect(getTrustlineStatusMessage("no_trustline", "USDC")).toContain(
        "No trustline established"
      );
    });
  });

  describe("classifyTrustlineStatus", () => {
    it("classifies authorized balances", () => {
      expect(classifyTrustlineStatus({ is_authorized: true })).toBe("authorized");
      expect(classifyTrustlineStatus({})).toBe("authorized");
    });

    it("classifies unauthorized (maintains liabilities only) balances", () => {
      expect(
        classifyTrustlineStatus({
          is_authorized: false,
          is_authorized_to_maintain_liabilities: true,
        })
      ).toBe("unauthorized");
    });

    it("classifies frozen balances (both authorized and liabilities false)", () => {
      expect(
        classifyTrustlineStatus({
          is_authorized: false,
          is_authorized_to_maintain_liabilities: false,
        })
      ).toBe("frozen");
    });
  });

  describe("Transaction Generation (createChangeTrustTransaction)", () => {
    it("builds a correct, memo-free change_trust transaction matching the client helper spec", () => {
      const account = new Account(testAccount, "1000");
      const tx = createChangeTrustTransaction({
        account,
        assetCode: "USDC",
        assetIssuer: usdcIssuer,
        limit: "10000",
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      });

      // 1. Correct operation type
      expect(tx.operations).toHaveLength(1);
      const op = tx.operations[0];
      expect(op.type).toBe("changeTrust");

      // 2. Correct asset & issuer
      if (op.type === "changeTrust") {
        expect(op.line.getCode()).toBe("USDC");
        expect(op.line.getIssuer()).toBe(usdcIssuer);
        expect(op.limit).toBe("10000");
      }

      // 3. Strictly memo-free
      expect(tx.memo.type).toBe("none");
      expect(tx.memo.value).toBeNull();

      // 4. Source and fee
      expect(tx.source).toBe(testAccount);
      expect(tx.fee).toBe(100);
    });

    it("defaults to max limit when limit is omitted", () => {
      const account = new Account(testAccount, "1001");
      const tx = createChangeTrustTransaction({
        account,
        assetCode: "USDC",
        assetIssuer: usdcIssuer,
        networkPassphrase: Networks.TESTNET,
      });

      expect(tx.operations).toHaveLength(1);
      const op = tx.operations[0];
      expect(op.type).toBe("changeTrust");
      if (op.type === "changeTrust") {
        expect(op.limit).toBe("922337203685.4775807");
      }
    });

    it("builds via async buildTrustlineTransaction when sequence is provided", async () => {
      const tx = await buildTrustlineTransaction({
        publicKey: testAccount,
        sequence: "500",
        assetCode: "USDC",
        assetIssuer: usdcIssuer,
      });

      expect(tx.source).toBe(testAccount);
      expect(tx.operations[0].type).toBe("changeTrust");
      expect(tx.memo.type).toBe("none");
    });
  });

  describe("canAffordTrustlineReserve & wouldExceedTrustlineLimit", () => {
    it("evaluates reserve requirements accurately", () => {
      // 0 subentries -> needs (3 + 0) * 0.5 = 1.5 XLM
      expect(canAffordTrustlineReserve("2.0", 0).canAfford).toBe(true);
      expect(canAffordTrustlineReserve("1.4", 0).canAfford).toBe(false);
      expect(canAffordTrustlineReserve("1.5", 0).canAfford).toBe(true);
      expect(canAffordTrustlineReserve("1.5", 0).requiredReserveXlm).toBe(1.5);

      // 1 existing subentry -> needs (3 + 1) * 0.5 = 2.0 XLM
      expect(canAffordTrustlineReserve("1.9", 1).canAfford).toBe(false);
      expect(canAffordTrustlineReserve("2.0", 1).canAfford).toBe(true);
    });

    it("evaluates trustline limit exhaustion", () => {
      expect(wouldExceedTrustlineLimit("100", "50", "200")).toBe(false);
      expect(wouldExceedTrustlineLimit("150", "51", "200")).toBe(true);
      expect(wouldExceedTrustlineLimit("100", "100", "200")).toBe(false);
    });
  });

  describe("checkTrustline with Horizon mock", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns no_trustline when account does not hold the asset", async () => {
      const mockServer = {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [
            {
              asset_type: "native",
              balance: "50.0",
            },
          ],
        }),
      };
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue(mockServer as any);

      const res = await checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(res.hasTrustline).toBe(false);
      expect(res.status).toBe("no_trustline");
      expect(res.actionRequired).toBe(true);
      expect(res.reserveRequirementXlm).toBe("0.5");
      expect(res.explanation).toContain("A trustline is an explicit agreement");
    });

    it("returns authorized when trustline is active", async () => {
      const mockServer = {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: usdcIssuer,
              balance: "125.50",
              limit: "5000",
              is_authorized: true,
              is_authorized_to_maintain_liabilities: true,
            },
          ],
        }),
      };
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue(mockServer as any);

      const res = await checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(res.hasTrustline).toBe(true);
      expect(res.status).toBe("authorized");
      expect(res.balance).toBe("125.50");
      expect(res.actionRequired).toBe(false);
      expect(res.message).toContain("Trustline active and authorized");
    });

    it("returns frozen when trustline is revoked/frozen by issuer", async () => {
      const mockServer = {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: usdcIssuer,
              balance: "50.0",
              limit: "5000",
              is_authorized: false,
              is_authorized_to_maintain_liabilities: false,
            },
          ],
        }),
      };
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue(mockServer as any);

      const res = await checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(res.hasTrustline).toBe(true);
      expect(res.status).toBe("frozen");
      expect(res.actionRequired).toBe(true);
      expect(res.message).toContain("Trustline frozen");
    });

    it("returns unauthorized when trustline requires authorization", async () => {
      const mockServer = {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: usdcIssuer,
              balance: "0",
              limit: "5000",
              is_authorized: false,
              is_authorized_to_maintain_liabilities: true,
            },
          ],
        }),
      };
      vi.spyOn(stellarLib, "getHorizonServer").mockReturnValue(mockServer as any);

      const res = await checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(res.hasTrustline).toBe(true);
      expect(res.status).toBe("unauthorized");
      expect(res.actionRequired).toBe(true);
      expect(res.message).toContain("Trustline unauthorized");
    });
  });

  describe("TrustlineSimulator", () => {
    let sim: TrustlineSimulator;

    beforeEach(() => {
      sim = new TrustlineSimulator();
      sim.createAccount(testAccount, "5.0", "10");
    });

    it("simulates empty trustline check", () => {
      const info = sim.checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(info.hasTrustline).toBe(false);
      expect(info.status).toBe("no_trustline");
    });

    it("simulates successful changeTrust creation", () => {
      const res = sim.changeTrust(testAccount, "USDC", usdcIssuer, "1000");
      expect(res.success).toBe(true);

      const info = sim.checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(info.hasTrustline).toBe(true);
      expect(info.status).toBe("authorized");
      expect(info.limit).toBe("1000");
    });

    it("simulates op_low_reserve when account lacks XLM for trustline reserve", () => {
      const poorAccount = Keypair.random().publicKey();
      // 1.0 XLM is minimum base reserve for account, needs 1.5 XLM for account + 1 trustline
      sim.createAccount(poorAccount, "1.2", "1");

      const res = sim.changeTrust(poorAccount, "USDC", usdcIssuer);
      expect(res.success).toBe(false);
      expect(res.error).toBe("op_low_reserve");
    });

    it("simulates freeze and unfreeze transitions", () => {
      sim.changeTrust(testAccount, "USDC", usdcIssuer);

      sim.freezeTrustline(testAccount, "USDC", usdcIssuer);
      let info = sim.checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(info.status).toBe("frozen");

      sim.authorizeTrustline(testAccount, "USDC", usdcIssuer);
      info = sim.checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(info.status).toBe("authorized");

      sim.setUnauthorizedTrustline(testAccount, "USDC", usdcIssuer);
      info = sim.checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(info.status).toBe("unauthorized");
    });

    it("simulates compiled Transaction execution", () => {
      const account = new Account(testAccount, "10");
      const tx = createChangeTrustTransaction({
        account,
        assetCode: "USDC",
        assetIssuer: usdcIssuer,
        limit: "50000",
      });

      const result = sim.simulateTransaction(tx);
      expect(result.success).toBe(true);
      expect(result.txHash).toContain("simulated_");

      const info = sim.checkTrustline(testAccount, "USDC", usdcIssuer);
      expect(info.hasTrustline).toBe(true);
      expect(info.limit).toBe("50000");
    });
  });
});
