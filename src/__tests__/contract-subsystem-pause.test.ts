// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SUBSYSTEM_FLAGS,
  SUBSYSTEM_FLAG_LABELS,
  parseSubsystemFlags,
  getSubsystemPauseFlags,
  isSubsystemPaused,
  setSubsystemPause,
} from "@/lib/contract-advanced";

vi.mock("@/lib/contracts", () => ({
  CHAIN_READ_SOURCE: "test",
  DEFAULT_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  EMITTER_CONTRACT_ID: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  simulateContractCall: vi.fn(),
  submitContractInvocation: vi.fn().mockResolvedValue({
    status: "SUCCESS",
    txHash: "tx_subsystem_123",
  }),
  classifyContractError: vi.fn((err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
    type: "CONTRACT",
  })),
  invokeContractFunction: vi.fn().mockResolvedValue({
    status: "AWAITING_SIGNATURE",
    xdr: "AAAA_unsigned_xdr",
    txHash: "tx_mock_123",
  }),
}));

vi.mock("@/lib/wallets", () => ({
  getActiveWalletConnector: vi.fn().mockReturnValue({
    signTransaction: vi.fn().mockResolvedValue("AAAA_signed_xdr"),
  }),
}));

vi.mock("@/lib/stellar", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_NETWORK: "TESTNET",
}));

import { simulateContractCall, invokeContractFunction, submitContractInvocation } from "@/lib/contracts";
const mockSimulate = vi.mocked(simulateContractCall);
const mockInvoke = vi.mocked(invokeContractFunction);
const mockSubmit = vi.mocked(submitContractInvocation);

describe("Granular Contract Capability Flags (#1358)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Bitmask Flag Definitions & Labels", () => {
    it("defines power-of-two bitflags for each subsystem and PAUSE_ALL = 255", () => {
      expect(SUBSYSTEM_FLAGS.PAUSE_PAYMENTS).toBe(1);
      expect(SUBSYSTEM_FLAGS.PAUSE_ESCROWS).toBe(2);
      expect(SUBSYSTEM_FLAGS.PAUSE_STREAMS).toBe(4);
      expect(SUBSYSTEM_FLAGS.PAUSE_GOVERNANCE).toBe(8);
      expect(SUBSYSTEM_FLAGS.PAUSE_RECURRING).toBe(16);
      expect(SUBSYSTEM_FLAGS.PAUSE_REFUNDS).toBe(32);
      expect(SUBSYSTEM_FLAGS.PAUSE_HOOKS).toBe(64);
      expect(SUBSYSTEM_FLAGS.PAUSE_BATCHES).toBe(128);
      expect(SUBSYSTEM_FLAGS.PAUSE_ALL).toBe(255);
    });

    it("has human-readable labels for all active flags", () => {
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_PAYMENTS]).toBe("Payments");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_ESCROWS]).toBe("Escrows");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_STREAMS]).toBe("Streams");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_GOVERNANCE]).toBe("Governance");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_RECURRING]).toBe("Recurring");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_REFUNDS]).toBe("Refunds");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_HOOKS]).toBe("Hooks");
      expect(SUBSYSTEM_FLAG_LABELS[SUBSYSTEM_FLAGS.PAUSE_BATCHES]).toBe("Batches");
    });

    it("parseSubsystemFlags accurately decomposes arbitrary bitmasks", () => {
      expect(parseSubsystemFlags(0)).toEqual([]);

      // Single flag
      expect(parseSubsystemFlags(SUBSYSTEM_FLAGS.PAUSE_ESCROWS)).toEqual([2]);

      // OR combination (Escrows 2 + Streams 4 = 6)
      expect(parseSubsystemFlags(6)).toEqual([2, 4]);

      // All flags
      expect(parseSubsystemFlags(SUBSYSTEM_FLAGS.PAUSE_ALL)).toEqual([
        1, 2, 4, 8, 16, 32, 64, 128,
      ]);
    });
  });

  describe("Contract Query & Invocation Helpers", () => {
    it("getSubsystemPauseFlags queries get_pause_flags and returns numeric bitmask", async () => {
      mockSimulate.mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: 6,
      } as unknown as never);

      const flags = await getSubsystemPauseFlags("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
      expect(flags).toBe(6);
      expect(mockSimulate).toHaveBeenCalledWith(
        expect.any(String),
        "get_pause_flags",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      );
    });

    it("isSubsystemPaused queries is_subsystem_paused with subsystem argument", async () => {
      mockSimulate.mockResolvedValueOnce({
        status: "SUCCESS",
        returnValue: true,
      } as unknown as never);

      const paused = await isSubsystemPaused(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        SUBSYSTEM_FLAGS.PAUSE_ESCROWS
      );
      expect(paused).toBe(true);
      expect(mockSimulate).toHaveBeenCalledWith(
        expect.any(String),
        "is_subsystem_paused",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        expect.any(Array)
      );
    });

    it("setSubsystemPause signs and submits set_subsystem_pause invocation", async () => {
      mockInvoke.mockResolvedValueOnce({
        status: "AWAITING_SIGNATURE",
        xdr: "unsigned_xdr",
        txHash: "tx_mock_123",
      });
      mockSubmit.mockResolvedValueOnce({
        status: "SUCCESS",
        txHash: "tx_hash_1358",
      });

      const res = await setSubsystemPause(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        SUBSYSTEM_FLAGS.PAUSE_ESCROWS,
        true
      );

      expect(mockInvoke).toHaveBeenCalledWith(
        expect.any(String),
        "set_subsystem_pause",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        expect.any(Array)
      );
      expect(res.success).toBe(true);
      expect(res.txHash).toBe("tx_hash_1358");
    });
  });
});
