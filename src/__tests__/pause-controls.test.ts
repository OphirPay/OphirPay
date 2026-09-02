// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the contracts module (needed by contract-advanced)
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
import { isPaused, emergencyPauseAll, emergencyUnpauseAll } from "@/lib/contract-advanced";
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

/** Helper: configure a successful sign-and-submit flow */
function mockSuccessfulSignAndSubmit() {
  const mockSignTransaction = vi.fn().mockResolvedValue(MOCK_SIGNED_XDR);
  vi.mocked(getActiveWalletConnector).mockReturnValue({
    signTransaction: mockSignTransaction,
  } as unknown as ReturnType<typeof getActiveWalletConnector>);
  vi.mocked(invokeContractFunction).mockResolvedValue({
    status: "AWAITING_SIGNATURE",
    txHash: MOCK_TX_HASH,
    xdr: "AAAAA==",
  });
  vi.mocked(submitContractInvocation).mockResolvedValue({
    txHash: MOCK_TX_HASH,
    status: "SUCCESS",
  });
  return { mockSignTransaction };
}

describe("Pause Controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isPaused", () => {
    it("returns true when contract is paused", async () => {
      vi.mocked(simulateContractCall).mockResolvedValue({
        status: "SIMULATED",
        returnValue: true,
      });

      const result = await isPaused(OWNER_KEY);

      expect(result).toBe(true);
      expect(simulateContractCall).toHaveBeenCalledWith(
        DEFAULT_CONTRACT_ID,
        "is_paused",
        OWNER_KEY
      );
    });

    it("returns false when contract is not paused", async () => {
      vi.mocked(simulateContractCall).mockResolvedValue({
        status: "SIMULATED",
        returnValue: false,
      });

      const result = await isPaused(OWNER_KEY);

      expect(result).toBe(false);
    });

    it("returns false on simulation failure", async () => {
      vi.mocked(simulateContractCall).mockResolvedValue({
        status: "SIMULATION_FAILED",
        returnValue: null,
        error: "Contract not found",
      });

      const result = await isPaused(OWNER_KEY);

      expect(result).toBe(false);
    });
  });

  describe("emergencyPauseAll", () => {
    it("invokes emergency_pause_all with owner address and submits successfully", async () => {
      mockSuccessfulSignAndSubmit();

      const result = await emergencyPauseAll(OWNER_KEY);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(MOCK_TX_HASH);

      // Verify the correct contract method was called with the owner address arg
      const invokeArgs = vi.mocked(invokeContractFunction).mock.calls[0];
      expect(invokeArgs[0]).toBe(DEFAULT_CONTRACT_ID);
      expect(invokeArgs[1]).toBe("emergency_pause_all");
      expect(invokeArgs[2]).toBe(OWNER_KEY);
      // Args array should contain exactly 1 ScVal (the caller address)
      const args = invokeArgs[3] as xdr.ScVal[];
      expect(args).toHaveLength(1);

      // Verify the wallet signed the transaction
      expect(getActiveWalletConnector).toHaveBeenCalled();
    });

    it("returns error when no wallet is available", async () => {
      vi.mocked(getActiveWalletConnector).mockReturnValue(null);

      const result = await emergencyPauseAll(OWNER_KEY);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No wallet available");
      expect(invokeContractFunction).not.toHaveBeenCalled();
    });
  });

  describe("emergencyUnpauseAll", () => {
    it("invokes emergency_unpause_all with owner address and submits successfully", async () => {
      mockSuccessfulSignAndSubmit();

      const result = await emergencyUnpauseAll(OWNER_KEY);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(MOCK_TX_HASH);

      // Verify the correct contract method was called with the owner address arg
      const invokeArgs = vi.mocked(invokeContractFunction).mock.calls[0];
      expect(invokeArgs[0]).toBe(DEFAULT_CONTRACT_ID);
      expect(invokeArgs[1]).toBe("emergency_unpause_all");
      expect(invokeArgs[2]).toBe(OWNER_KEY);
      const args = invokeArgs[3] as xdr.ScVal[];
      expect(args).toHaveLength(1);

      expect(getActiveWalletConnector).toHaveBeenCalled();
    });

    it("returns error when no wallet is available", async () => {
      vi.mocked(getActiveWalletConnector).mockReturnValue(null);

      const result = await emergencyUnpauseAll(OWNER_KEY);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No wallet available");
      expect(invokeContractFunction).not.toHaveBeenCalled();
    });
  });
});
