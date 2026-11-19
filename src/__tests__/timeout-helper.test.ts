// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TimeoutError,
  isTimeoutError,
  withAbortableTimeout,
  fetchWithTimeout,
  withStellarTimeoutProxy,
  getStellarTimeoutMs,
  getHorizonTimeoutMs,
} from "@/lib/timeout";
import { classifyContractError, ContractErrorType } from "@/lib/contracts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.HORIZON_REQUEST_TIMEOUT_MS;
  delete process.env.STELLAR_REQUEST_TIMEOUT_MS;
});

describe("configurable timeout budgets", () => {
  it("falls back to the Stellar budget when a specific value is unset", () => {
    delete process.env.STELLAR_REQUEST_TIMEOUT_MS;
    expect(getStellarTimeoutMs()).toBe(10_000);
    expect(getHorizonTimeoutMs()).toBe(10_000);
  });

  it("reads a positive override from the environment", () => {
    process.env.STELLAR_REQUEST_TIMEOUT_MS = "2500";
    process.env.HORIZON_REQUEST_TIMEOUT_MS = "1234";
    expect(getStellarTimeoutMs()).toBe(2500);
    expect(getHorizonTimeoutMs()).toBe(1234);
  });

  it("ignores invalid (non-positive / non-numeric) overrides", () => {
    process.env.STELLAR_REQUEST_TIMEOUT_MS = "0";
    expect(getStellarTimeoutMs()).toBe(10_000);
    process.env.HORIZON_REQUEST_TIMEOUT_MS = "not-a-number";
    expect(getHorizonTimeoutMs()).toBe(10_000);
  });
});

describe("isTimeoutError", () => {
  it("recognises our classified timeout error", () => {
    expect(isTimeoutError(new TimeoutError(1000, "Horizon"))).toBe(true);
  });

  it("recognises SDK-style timeout messages", () => {
    expect(isTimeoutError(new Error("timeout of 10000ms exceeded"))).toBe(true);
    expect(isTimeoutError(new Error("Request timed out"))).toBe(true);
  });

  it("does not misclassify unrelated errors", () => {
    expect(isTimeoutError(new Error("boom"))).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});

describe("withAbortableTimeout", () => {
  it("throws a classified TimeoutError when the budget elapses", async () => {
    const pending = withAbortableTimeout(
      () => new Promise<never>(() => {}),
      { timeoutMs: 10, label: "test op" }
    );
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT", label: "test op" });
  });

  it("aborts the operation's signal on timeout", async () => {
    let aborted = false;
    const pending = withAbortableTimeout(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      { timeoutMs: 10, label: "abortable" }
    );
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it("propagates a caller-initiated abort instead of reporting a timeout", async () => {
    const caller = new AbortController();
    const pending = withAbortableTimeout(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        }),
      { timeoutMs: 60_000, signal: caller.signal }
    );
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("fetchWithTimeout", () => {
  it("aborts a stalled fetch and throws a classified TimeoutError", async () => {
    let sawSignal = false;
    vi.stubGlobal(
      "fetch",
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          sawSignal = init?.signal instanceof AbortSignal;
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );

    await expect(
      fetchWithTimeout("https://example.test", {}, { timeoutMs: 10, label: "HTTP probe" })
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(sawSignal).toBe(true);
  });

  it("resolves when the fetch completes within budget", async () => {
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    const res = await fetchWithTimeout("https://example.test", {}, { timeoutMs: 1000 });
    expect(res.status).toBe(200);
  });
});

describe("withStellarTimeoutProxy", () => {
  it("passes through resolved server methods and builder .call()", async () => {
    const server = {
      loadAccount: vi.fn().mockResolvedValue({ id: "acct" }),
      strictSendPaths: vi
        .fn()
        .mockReturnValue({ call: vi.fn().mockResolvedValue({ records: [] }) }),
    };
    const wrapped = withStellarTimeoutProxy(server, 1000, "Horizon");

    await expect(wrapped.loadAccount("GADDR")).resolves.toEqual({ id: "acct" });
    await expect(wrapped.strictSendPaths().call()).resolves.toEqual({ records: [] });
  });

  it("classifies a stalled server method as a timeout", async () => {
    const server = { loadAccount: (_key: string) => new Promise<never>(() => {}) };
    const wrapped = withStellarTimeoutProxy(server, 10, "Horizon");
    await expect(wrapped.loadAccount("GADDR")).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("classifyContractError — timeouts", () => {
  it("maps a timeout to a NETWORK error with actionable copy", () => {
    const err = classifyContractError(new TimeoutError(10_000, "Horizon.loadAccount"));
    expect(err.type).toBe(ContractErrorType.NETWORK);
    expect(err.message).toMatch(/did not respond in time/i);
  });
});
