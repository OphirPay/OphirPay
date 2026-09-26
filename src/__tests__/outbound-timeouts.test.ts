// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TimeoutError,
  isTimeoutError,
  withTimeout,
  fetchWithTimeout,
  combineSignals,
  STELLAR_TIMEOUT_MS,
  PRICE_TIMEOUT_MS,
  WEBHOOK_TIMEOUT_MS,
  RPC_PROBE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/timeout";
import {
  fetchXlmBalance,
  fetchAllBalances,
  accountExists,
  findStrictSendPath,
  parseSubmissionError,
  getHorizonServer,
  getSorobanServer,
} from "@/lib/stellar";
import {
  simulateContractCall,
  classifyContractError,
  ContractError,
  ContractErrorType,
} from "@/lib/contracts";
import { estimateTransactionFee } from "@/lib/fee-estimator";
import { simulatePayment } from "@/lib/transaction-simulator";
import { checkTrustline } from "@/lib/trustline";

describe("Outbound Call Timeouts & Recovery (#747)", () => {
  describe("Timeout Constants & Defaults", () => {
    it("has sane default timeout budgets", () => {
      expect(STELLAR_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
      expect(PRICE_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
      expect(WEBHOOK_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
      expect(RPC_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
      expect(DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    });
  });

  describe("TimeoutError & isTimeoutError", () => {
    it("instantiates TimeoutError with custom message, name, and timeoutMs", () => {
      const err = new TimeoutError("Network call timed out", 4500);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(TimeoutError);
      expect(err.name).toBe("TimeoutError");
      expect(err.code).toBe("TIMEOUT");
      expect(err.message).toBe("Network call timed out");
      expect(err.timeoutMs).toBe(4500);
    });

    it("identifies various timeout representations via isTimeoutError", () => {
      expect(isTimeoutError(new TimeoutError("rpc timed out", 1000))).toBe(true);
      expect(isTimeoutError({ name: "TimeoutError", message: "timed out" })).toBe(true);
      expect(isTimeoutError({ name: "AbortError", message: "aborted" })).toBe(true);
      expect(isTimeoutError({ code: "TIMEOUT", message: "failed" })).toBe(true);
      expect(isTimeoutError(new Error("Soroban RPC request timed out"))).toBe(true);
      expect(isTimeoutError(new Error("The operation was aborted"))).toBe(true);
      expect(isTimeoutError(new Error("Connection timed out after 3000ms"))).toBe(true);
      expect(isTimeoutError(new Error("unrelated database error"))).toBe(false);
      expect(isTimeoutError(null)).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
    });
  });

  describe("withTimeout helper", () => {
    it("resolves promptly when promise finishes before timeout", async () => {
      const result = await withTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("success"), 10)),
        100
      );
      expect(result).toBe("success");
    });

    it("rejects with TimeoutError when promise takes too long", async () => {
      await expect(
        withTimeout(
          new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 150)),
          20,
          "Call took too long"
        )
      ).rejects.toThrow("Call took too long");
    });

    it("passes an AbortSignal to callback function and aborts on timeout", async () => {
      let aborted = false;
      await expect(
        withTimeout((signal) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return new Promise<string>(() => {});
        }, 30)
      ).rejects.toThrow(TimeoutError);

      expect(aborted).toBe(true);
    });

    it("propagates inner rejection when promise fails before timeout", async () => {
      await expect(
        withTimeout(Promise.reject(new Error("inner failure")), 100)
      ).rejects.toThrow("inner failure");
    });
  });

  describe("combineSignals", () => {
    it("triggers abort if any underlying signal aborts", () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const combined = combineSignals([ac1.signal, ac2.signal]);

      expect(combined.aborted).toBe(false);
      ac2.abort("reason");
      expect(combined.aborted).toBe(true);
    });

    it("returns pre-aborted signal if already aborted", () => {
      const ac = new AbortController();
      ac.abort("immediate");
      const combined = combineSignals([ac.signal]);
      expect(combined.aborted).toBe(true);
    });
  });

  describe("fetchWithTimeout", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("resolves fetch response when it completes within timeout", async () => {
      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

      const res = await fetchWithTimeout("https://example.com/api", {}, 100);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it("aborts fetch call when timeout expires", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          })
      );

      await expect(
        fetchWithTimeout("https://example.com/api", {}, 25, "Custom fetch timeout")
      ).rejects.toThrow("Custom fetch timeout");
    });
  });

  describe("parseSubmissionError timeout handling", () => {
    it("returns clear timeout message for TimeoutError", () => {
      const msg = parseSubmissionError(new TimeoutError("Horizon timed out"));
      expect(msg).toBe("Stellar request timed out. Please check your network connection and try again.");
    });

    it("returns clear timeout message for raw timeout string", () => {
      const msg = parseSubmissionError(new Error("Stellar Horizon submitTransaction timed out"));
      expect(msg).toBe("Stellar request timed out. Please check your network connection and try again.");
    });

    it("returns clear timeout message for tx_timeout code", () => {
      const msg = parseSubmissionError(new Error("Error during submission: tx_timeout"));
      expect(msg).toBe("Stellar request timed out. Please check your network connection and try again.");
    });
  });

  describe("classifyContractError timeout classification", () => {
    it("classifies TimeoutError as ContractErrorType.TIMEOUT", () => {
      const err = classifyContractError(new TimeoutError("Soroban RPC request timed out"));
      expect(err.type).toBe(ContractErrorType.TIMEOUT);
      expect(err.message).toContain("Soroban RPC request timed out");
      expect(err.message).toContain("Please check network connectivity");
    });

    it("classifies timed out messages without network as TIMEOUT", () => {
      const err = classifyContractError(new Error("simulateTransaction timed out after 10000ms"));
      expect(err.type).toBe(ContractErrorType.TIMEOUT);
    });

    it("preserves NETWORK classification when error explicitly indicates network timeout", () => {
      const err = classifyContractError(new Error("network timeout fetching RPC"));
      expect(err.type).toBe(ContractErrorType.NETWORK);
    });
  });

  describe("Stellar Horizon Outbound Calls with Timeouts", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("fetchXlmBalance throws TimeoutError when Horizon hangs", async () => {
      const mockServer = {
        loadAccount: vi.fn().mockImplementation(
          () => new Promise((_resolve) => setTimeout(_resolve, 200))
        ),
      };
      vi.spyOn(await import("@/lib/stellar"), "getHorizonServer").mockReturnValue(
        mockServer as unknown as ReturnType<typeof getHorizonServer>
      );

      await expect(
        fetchXlmBalance("GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ", 20)
      ).rejects.toThrow("Stellar Horizon loadAccount timed out");
    });

    it("fetchAllBalances throws TimeoutError when Horizon hangs", async () => {
      const mockServer = {
        loadAccount: vi.fn().mockImplementation(
          () => new Promise((_resolve) => setTimeout(_resolve, 200))
        ),
      };
      vi.spyOn(await import("@/lib/stellar"), "getHorizonServer").mockReturnValue(
        mockServer as unknown as ReturnType<typeof getHorizonServer>
      );

      await expect(
        fetchAllBalances("GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ", 20)
      ).rejects.toThrow("Stellar Horizon loadAccount timed out");
    });

    it("findStrictSendPath returns null gracefully when strictSendPaths times out", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "strictSendPaths").mockReturnValue({
        call: vi.fn().mockRejectedValue(
          new TimeoutError("Stellar Horizon strictSendPaths timed out", 1000)
        ),
      } as unknown as ReturnType<typeof server.strictSendPaths>);

      const result = await findStrictSendPath({
        sourceAssetCode: "XLM",
        sendAmount: "10",
        destAssetCode: "USDC",
        destAssetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      });

      expect(result).toBeNull();
    });

    it("estimateTransactionFee falls back to 100 stroops when fetchBaseFee times out", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "fetchBaseFee").mockRejectedValue(
        new TimeoutError("Stellar Horizon fetchBaseFee timed out", 1000)
      );

      const fee = await estimateTransactionFee(2);
      expect(fee.baseFee).toBe("100");
      expect(fee.estimatedFee).toBe("200");
      expect(fee.networkCongestion).toBe("low");
    });

    it("checkTrustline returns hasTrustline false when loadAccount times out", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "loadAccount").mockRejectedValue(
        new TimeoutError("Stellar Horizon loadAccount timed out", 1000)
      );

      const res = await checkTrustline(
        "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
        "USDC",
        "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
      );
      expect(res.hasTrustline).toBe(false);
    });

    it("accountExists rethrows TimeoutError when Horizon hangs", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "loadAccount").mockRejectedValue(
        new TimeoutError("Stellar Horizon loadAccount timed out", 1000)
      );

      await expect(
        accountExists("GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ")
      ).rejects.toThrow("Stellar Horizon loadAccount timed out");
    });

    it("simulatePayment surfaces error when loadAccount times out", async () => {
      const server = getHorizonServer();
      vi.spyOn(server, "loadAccount").mockRejectedValue(
        new TimeoutError("Stellar Horizon loadAccount timed out", 1000)
      );

      const result = await simulatePayment({
        sourcePublicKey: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
        destination: "GACNKEDGJYLLVQDXWYEEPB47Y3JEV5JNZ3RQANTJIVKKEOXX4NC4YWHU",
        amount: "10",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    });
  });

  describe("Soroban RPC Outbound Calls with Timeouts", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("simulateContractCall handles Soroban RPC timeout gracefully", async () => {
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
      const server = getSorobanServer();
      vi.spyOn(server, "getAccount").mockRejectedValue(
        new TimeoutError("Soroban RPC account fetch timed out", 1000)
      );

      let thrownError: unknown;
      try {
        await simulateContractCall(
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
          "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
          "ping",
          []
        );
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(ContractError);
      expect((thrownError as ContractError).type).toBe(ContractErrorType.TIMEOUT);
      expect((thrownError as ContractError).message).toContain("Soroban RPC request timed out");
    });
  });

  describe("Price Feed & Webhook Timeouts", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("fetchXlmPrice flags timeout when upstream price feeds time out", async () => {
      const { fetchXlmPrice } = await import("@/lib/price");
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new DOMException("The operation was aborted", "AbortError")), 20);
          })
      );

      const result = await fetchXlmPrice({ timeoutMs: 15, forceRefresh: true });
      expect(result.price).toBeNull();
      expect(result.error).toContain("timed out");
    });

    it("deliverWebhook reports timeout error message when webhook delivery hangs", async () => {
      const { deliverWebhook } = await import("@/lib/webhook-deliver");
      const guard = await import("@/lib/webhook-url-guard");
      vi.spyOn(guard, "isSafeWebhookUrlAtDelivery").mockResolvedValue(true);

      vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new DOMException("The operation was aborted", "AbortError")), 20);
          })
      );

      const result = await deliverWebhook(
        "https://webhook.site/test-hook",
        "secret-key",
        { event: "payment.succeeded", timestamp: new Date().toISOString(), data: {} },
        1
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("timed out");
    });
  });
});
