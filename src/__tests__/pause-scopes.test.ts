// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the contracts module (needed by contract-advanced) — mirrors the
// existing pause-controls suite so the scoped helpers are exercised through
// the same signing pipeline.
vi.mock("@/lib/contracts", () => ({
  simulateContractCall: vi.fn(),
  invokeContractFunction: vi.fn(),
  submitContractInvocation: vi.fn(),
  classifyContractError: vi.fn((err) => ({
    message: err instanceof Error ? err.message : String(err),
    type: "CONTRACT",
  })),
  DEFAULT_CONTRACT_ID: "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET",
  EMITTER_CONTRACT_ID: "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN",
}));

vi.mock("@/lib/stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_NETWORK: "TESTNET",
}));

vi.mock("@/lib/wallets", () => ({
  getActiveWalletConnector: vi.fn(),
}));

// Import after mocks
import { PauseScope, getPausedScopes, setScopePaused } from "@/lib/contract-advanced";
import {
  simulateContractCall,
  invokeContractFunction,
  submitContractInvocation,
  DEFAULT_CONTRACT_ID,
} from "@/lib/contracts";
import { getActiveWalletConnector } from "@/lib/wallets";
import type { xdr } from "@stellar/stellar-sdk";

const OWNER_KEY = "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU";
const MOCK_SIGNED_XDR = "AAAAA==";
const MOCK_TX_HASH = "abc123def456";

/** Configure a successful sign-and-submit flow. */
function mockSuccessfulSignAndSubmit() {
  const mockSignTransaction = vi.fn().mockResolvedValue(MOCK_SIGNED_XDR);
  vi.mocked(getActiveWalletConnector).mockReturnValue({
    signTransaction: mockSignTransaction,
  } as unknown as ReturnType<typeof getActiveWalletConnector>);
  vi.mocked(invokeContractFunction).mockResolvedValue({
    status: "AWAITING_SIGNATURE",
    txHash: MOCK_TX_HASH,
    xdr: MOCK_SIGNED_XDR,
  });
  vi.mocked(submitContractInvocation).mockResolvedValue({
    txHash: MOCK_TX_HASH,
    status: "SUCCESS",
  });
}

describe("Scoped pause controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPausedScopes", () => {
    it("returns the paused scope ids from the simulated call", async () => {
      vi.mocked(simulateContractCall).mockResolvedValue({
        status: "SIMULATED",
        returnValue: [0, 3],
      });

      const result = await getPausedScopes(OWNER_KEY);

      expect(result).toEqual([0, 3]);
      expect(simulateContractCall).toHaveBeenCalledWith(
        DEFAULT_CONTRACT_ID,
        "get_paused_scopes",
        OWNER_KEY
      );
    });

    it("returns an empty list when the simulation fails", async () => {
      vi.mocked(simulateContractCall).mockResolvedValue({
        status: "SIMULATION_FAILED",
        returnValue: null,
        error: "Contract not found",
      });

      expect(await getPausedScopes(OWNER_KEY)).toEqual([]);
    });

    it("coerces numeric strings and drops out-of-range ids", async () => {
      vi.mocked(simulateContractCall).mockResolvedValue({
        status: "SIMULATED",
        returnValue: [0, -1, "3"],
      });

      expect(await getPausedScopes(OWNER_KEY)).toEqual([0, 3]);
    });
  });

  describe("setScopePaused", () => {
    it("invokes set_scope_paused with the caller, scope id and flag", async () => {
      mockSuccessfulSignAndSubmit();

      const result = await setScopePaused(OWNER_KEY, PauseScope.Escrows, true);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(MOCK_TX_HASH);

      const invokeArgs = vi.mocked(invokeContractFunction).mock.calls[0];
      expect(invokeArgs[0]).toBe(DEFAULT_CONTRACT_ID);
      expect(invokeArgs[1]).toBe("set_scope_paused");
      expect(invokeArgs[2]).toBe(OWNER_KEY);
      // caller (address) + scope (u32) + paused (bool)
      expect(invokeArgs[3] as xdr.ScVal[]).toHaveLength(3);
      expect(getActiveWalletConnector).toHaveBeenCalled();
    });

    it("returns an error when no wallet is available", async () => {
      vi.mocked(getActiveWalletConnector).mockReturnValue(null);

      const result = await setScopePaused(OWNER_KEY, PauseScope.Payments, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No wallet available");
      expect(invokeContractFunction).not.toHaveBeenCalled();
    });
  });
});
