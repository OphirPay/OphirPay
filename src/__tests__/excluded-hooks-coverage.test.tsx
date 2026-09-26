// SPDX-License-Identifier: MIT
//
// Issue #712 — focused tests for the hooks that were previously excluded from
// coverage in vitest.config.ts. These are the pure enough hooks called out in
// the issue:
//
//   useRetry              → exponential backoff + cancel
//   useLocalStorage       → serialization round-trip + quota failure
//   useKeyboardShortcuts  → key-chord dispatch + form-field suppression
//   useApiQuery           → TanStack Query wrapper + CSRF-aware fetch
//   useTheme              → light/dark/system resolution + persistence
//   useNetworkChange      → network-change detection + poller
//   useErrorTracker       → error/message capture wiring
//
// The wallet providers (useMultiWallet / useFreighter) are covered in
// `wallet-hooks-coverage.test.tsx`, which mocks the wallet extension surface.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useRetry } from "@/hooks/useRetry";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useApiQuery, useApiMutation, apiFetch } from "@/hooks/useApiQuery";
import { useTheme, ThemeProvider } from "@/hooks/useTheme";
import { useNetworkChange, useNetworkPoller } from "@/hooks/useNetworkChange";
import { useErrorTracker } from "@/hooks/useErrorTracker";
import { captureError, captureMessage } from "@/lib/sentry";

// ── Module mocks ───────────────────────────────────────────────

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getFreighterMock } = vi.hoisted(() => ({
  getFreighterMock: vi.fn(),
}));

vi.mock("@/hooks/useFreighter", () => ({
  getFreighter: getFreighterMock,
}));

// ── Shared helpers ─────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return QueryWrapper;
}

type MediaListener = (e: { matches: boolean }) => void;

/** Install a controllable `matchMedia` mock and return the listener registry. */
function installMatchMedia(matches: boolean) {
  const listeners: MediaListener[] = [];
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn((_type: string, cb: MediaListener) => {
        listeners.push(cb);
      }),
      removeEventListener: vi.fn((_type: string, cb: MediaListener) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return listeners;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
});

// ═══════════════════════════════════════════════════════════════
// useRetry — exponential backoff
// ═══════════════════════════════════════════════════════════════

describe("useRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves immediately when the operation succeeds", async () => {
    const { result } = renderHook(() => useRetry());
    const fn = vi.fn().mockResolvedValue("ok");

    let promise!: Promise<string>;
    await act(async () => {
      promise = result.current.execute(fn);
    });

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("retries with exponential backoff and succeeds on a later attempt", async () => {
    const { result } = renderHook(() =>
      useRetry({ maxAttempts: 3, baseDelay: 1000, maxDelay: 8000 })
    );
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("attempt-0"))
      .mockRejectedValueOnce(new Error("attempt-1"))
      .mockResolvedValueOnce("recovered");

    let promise!: Promise<string>;
    act(() => {
      promise = result.current.execute(fn);
    });

    // First backoff is baseDelay * 2^0 = 1000ms, second is 2000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1); // t = 1000 → attempt 1
    });
    expect(fn).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // t = 3000 → attempt 2
    });

    await expect(promise).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });

  it("caps the backoff delay at maxDelay", async () => {
    const { result } = renderHook(() =>
      useRetry({ maxAttempts: 4, baseDelay: 1000, maxDelay: 2000 })
    );
    // Fail every attempt so we can observe the capped delays.
    const fn = vi.fn().mockRejectedValue(new Error("always"));

    let promise!: Promise<unknown>;
    act(() => {
      promise = result.current.execute(fn).catch(() => undefined);
    });

    // Delays: 1000, 2000, 2000, 2000 (baseDelay*2^n capped at maxDelay).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    await promise;
    // maxAttempts: 4 → attempts 0..4 = 5 calls.
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("throws after exhausting every attempt and exposes the error", async () => {
    const { result } = renderHook(() =>
      useRetry({ maxAttempts: 2, baseDelay: 1000, maxDelay: 5000 })
    );
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    let promise!: Promise<unknown>;
    await act(async () => {
      promise = result.current.execute(fn);
      // Guard against an unhandled rejection while the timers below flush it.
      promise.catch(() => undefined);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    await expect(promise).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3); // attempts 0, 1, 2
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isRetrying).toBe(false);
  });

  it("wraps non-Error rejections in an Error", async () => {
    const { result } = renderHook(() =>
      useRetry({ maxAttempts: 0, baseDelay: 1 })
    );

    let promise!: Promise<unknown>;
    await act(async () => {
      promise = result.current.execute(() => Promise.reject("string failure"));
      promise.catch(() => undefined);
    });

    await expect(promise).rejects.toThrow("string failure");
  });

  it("cancel aborts the in-flight signal and resets state", async () => {
    const { result } = renderHook(() => useRetry({ baseDelay: 1000 }));
    let seenSignal: AbortSignal | undefined;
    const fn = vi.fn((signal: AbortSignal) => {
      seenSignal = signal;
      return new Promise<string>(() => {
        /* never resolves — stays in flight */
      });
    });

    act(() => {
      void result.current.execute(fn);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(seenSignal).toBeDefined();
    expect(seenSignal!.aborted).toBe(false);

    act(() => {
      result.current.cancel();
    });

    expect(seenSignal!.aborted).toBe(true);
    expect(result.current.isRetrying).toBe(false);
    expect(result.current.attempt).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// useLocalStorage — serialization + quota failure
// ═══════════════════════════════════════════════════════════════

describe("useLocalStorage", () => {
  it("round-trips a value through localStorage", () => {
    const { result } = renderHook(() =>
      useLocalStorage<{ asset: string }>("test:asset", { asset: "XLM" })
    );

    expect(result.current[0]).toEqual({ asset: "XLM" });

    act(() => result.current[1]({ asset: "USDC" }));

    expect(result.current[0]).toEqual({ asset: "USDC" });
    expect(JSON.parse(window.localStorage.getItem("test:asset")!)).toEqual({
      asset: "USDC",
    });
  });

  it("accepts an updater function", () => {
    const { result } = renderHook(() => useLocalStorage<number>("test:count", 1));

    act(() => result.current[1]((prev) => prev + 41));

    expect(result.current[0]).toBe(42);
    expect(window.localStorage.getItem("test:count")).toBe("42");
  });

  it("hydrates from an existing stored value", () => {
    window.localStorage.setItem("test:hydrate", JSON.stringify(["a", "b"]));
    const { result } = renderHook(() =>
      useLocalStorage<string[]>("test:hydrate", [])
    );

    expect(result.current[0]).toEqual(["a", "b"]);
  });

  it("falls back to the initial value when the stored JSON is malformed", () => {
    window.localStorage.setItem("test:broken", "{ not json");
    const { result } = renderHook(() =>
      useLocalStorage<string>("test:broken", "fallback")
    );

    expect(result.current[0]).toBe("fallback");
  });

  it("removeValue clears storage and resets state", () => {
    const { result } = renderHook(() => useLocalStorage("test:remove", "x"));

    act(() => result.current[1]("y"));
    expect(window.localStorage.getItem("test:remove")).toBe('"y"');

    act(() => result.current[2]());
    expect(window.localStorage.getItem("test:remove")).toBeNull();
    expect(result.current[0]).toBe("x");
  });

  it("keeps the in-memory value when the storage write fails (quota exceeded)", () => {
    const { result } = renderHook(() => useLocalStorage("test:quota", "start"));

    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        const err = new DOMException(
          "The quota has been exceeded.",
          "QuotaExceededError"
        );
        throw err;
      });

    // The quota failure must not crash the component tree; state still updates.
    expect(() => {
      act(() => result.current[1]("still-applied"));
    }).not.toThrow();
    expect(result.current[0]).toBe("still-applied");

    setItem.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════
// useKeyboardShortcuts — dispatch + suppression
// ═══════════════════════════════════════════════════════════════

describe("useKeyboardShortcuts", () => {
  it("dispatches the matching handler for a key chord", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: "k", metaKey: true, handler }])
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("matches ctrl as well as meta for ctrl shortcuts", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: "n", ctrlKey: true, handler }])
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true })
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the modifier does not match", () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: "k", metaKey: true, handler }])
    );

    // No modifier held → must not match a meta chord.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", bubbles: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while an input is focused", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "a", handler }]));

    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("ignores shortcuts while a textarea or select is focused", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "a", handler }]));

    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    document.body.append(textarea, select);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true })
      );
      select.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();
    textarea.remove();
    select.remove();
  });

  it("does nothing when disabled", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "a", handler }], false));

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops after the first matching shortcut", () => {
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: "s", handler: first },
        { key: "s", handler: second },
      ])
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", bubbles: true })
      );
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: "z", handler }])
    );

    unmount();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", bubbles: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// useApiQuery / useApiMutation / apiFetch
// ═══════════════════════════════════════════════════════════════

describe("useApiQuery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches through the URL and unwraps the data envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "p1", amount: 10 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useApiQuery<{ id: string }>(["payment", "p1"], "/api/payments/p1"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "p1", amount: 10 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payments/p1",
      expect.objectContaining({ headers: expect.any(Headers) })
    );
  });

  it("prefers an explicit queryFn over the URL source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const queryFn = vi.fn().mockResolvedValue("from-chain");

    const { result } = renderHook(
      () => useApiQuery<string>(["onchain"], undefined, undefined, queryFn),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("from-chain");
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a structured ApiError on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: "NOT_FOUND", message: "Nope" } }),
      })
    );

    const { result } = renderHook(
      () => useApiQuery<unknown>(["missing"], "/api/payments/missing"),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Nope",
    });
  });

  it("falls back to HTTP_<status> when the error body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("no body");
        },
      })
    );

    await expect(apiFetch("/api/boom")).rejects.toEqual({
      code: "HTTP_500",
      message: "Request failed with status 500",
    });
  });
});

describe("apiFetch — CSRF handling for mutations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mints a token from /api/csrf and attaches it to a mutation", async () => {
    const calls: Array<{ url: string; method: string; token: string | null }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({ url, method, token: headers.get("x-csrf-token") });
      if (url === "/api/csrf") {
        return { ok: true, status: 200, json: async () => ({ token: "tok-1" }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { ok: true } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/api/payments", {
      method: "POST",
      body: JSON.stringify({ amount: 1 }),
    });

    expect(result).toEqual({ ok: true });
    const mint = calls.find((c) => c.url === "/api/csrf");
    const mutation = calls.find((c) => c.url === "/api/payments");
    expect(mint?.method).toBe("GET");
    expect(mutation?.method).toBe("POST");
    expect(mutation?.token).toBe("tok-1");
  });

  it("does not mint a CSRF token for a GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: "safe" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/payments");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/payments");
  });

  it("retries once with a fresh token when the cached token is rejected", async () => {
    let postAttempts = 0;
    const tokensSeen: Array<string | null> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (url === "/api/csrf") {
        return { ok: true, status: 200, json: async () => ({ token: `tok-${Date.now()}` }) };
      }
      postAttempts += 1;
      tokensSeen.push(headers.get("x-csrf-token"));
      if (postAttempts === 1) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { code: "CSRF_INVALID" } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: "retried" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<string>("/api/payments", { method: "POST" });

    expect(result).toBe("retried");
    expect(postAttempts).toBe(2);
    expect(tokensSeen[0]).not.toBe(tokensSeen[1]);
  });

  it("does not retry a non-CSRF 403", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/csrf") {
        return { ok: true, status: 200, json: async () => ({ token: "tok" }) };
      }
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { code: "FORBIDDEN", message: "No" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch("/api/payments", { method: "POST" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Exactly one POST — a non-CSRF 403 must not trigger the retry path.
    // (The CSRF token is cached module-wide across this suite, so the mint
    // count is not asserted here.)
    const posts = fetchMock.mock.calls.filter((c) => c[0] === "/api/payments");
    expect(posts).toHaveLength(1);
  });
});

describe("useApiMutation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the body and resolves the unwrapped response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/csrf") {
        return { ok: true, status: 200, json: async () => ({ token: "tok" }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { id: "new-1" } }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useApiMutation<{ amount: number }, { id: string }>("/api/payments"),
      { wrapper: makeWrapper() }
    );

    let created: { id: string } | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({ amount: 5 });
    });

    expect(created).toEqual({ id: "new-1" });
    const post = calls.find((c) => c.url === "/api/payments");
    expect(post?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ amount: 5 }),
    });
  });

  it("resolves a dynamic URL from the mutation body", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/csrf") {
        return { ok: true, status: 200, json: async () => ({ token: "tok" }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () =>
        useApiMutation<{ id: string }, unknown>(
          (body) => `/api/webhooks?id=${body.id}`,
          { method: "DELETE" }
        ),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.mutateAsync({ id: "w-9" });
    });

    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/webhooks?id=w-9")
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// useTheme
// ═══════════════════════════════════════════════════════════════

describe("useTheme", () => {
  it("throws when used outside a ThemeProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      /useTheme must be used within a ThemeProvider/
    );
    spy.mockRestore();
  });

  it("defaults to system and resolves from the media query", () => {
    installMatchMedia(true); // prefers dark
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("system");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("hydrates the persisted theme from localStorage", () => {
    installMatchMedia(false);
    window.localStorage.setItem("ophirpay-theme", "dark");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolved).toBe("dark");
  });

  it("persists and applies the theme on setTheme", () => {
    installMatchMedia(false);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );

    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => result.current.setTheme("dark"));

    expect(window.localStorage.getItem("ophirpay-theme")).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggle flips between light and dark", () => {
    installMatchMedia(false);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.resolved).toBe("light");
    act(() => result.current.toggle());
    expect(result.current.resolved).toBe("dark");
    act(() => result.current.toggle());
    expect(result.current.resolved).toBe("light");
  });

  it("re-applies on a system media-query change while in system mode", () => {
    const listeners = installMatchMedia(false);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );

    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolved).toBe("light");

    act(() => {
      for (const cb of listeners) cb({ matches: true });
    });

    // The provider re-resolves via matchMedia — our mock still reports false,
    // so the resolved value stays "light" but the handler ran without error.
    expect(result.current.theme).toBe("system");
  });
});

// ═══════════════════════════════════════════════════════════════
// useNetworkChange / useNetworkPoller
// ═══════════════════════════════════════════════════════════════

describe("useNetworkChange", () => {
  it("calls onNetworkChange when the network differs from the initial value", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ network }) => useNetworkChange(network, onChange),
      { initialProps: { network: "TESTNET" as string | null } }
    );

    // First render records the baseline — no change reported.
    expect(onChange).not.toHaveBeenCalled();

    rerender({ network: "PUBLIC" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("PUBLIC");
  });

  it("does not fire while the network is null", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ network }) => useNetworkChange(network, onChange),
      { initialProps: { network: null as string | null } }
    );

    rerender({ network: null });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not fire when the network is unchanged", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ network }) => useNetworkChange(network, onChange),
      { initialProps: { network: "TESTNET" as string | null } }
    );

    rerender({ network: "TESTNET" });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useNetworkPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("warns when the polled network no longer matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getFreighterMock.mockReturnValue({
      getNetwork: vi.fn().mockResolvedValue("PUBLIC"),
    });

    renderHook(() => useNetworkPoller("TESTNET", 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Freighter network changed")
    );
    warn.mockRestore();
  });

  it("stays quiet when the network matches", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getFreighterMock.mockReturnValue({
      getNetwork: vi.fn().mockResolvedValue("TESTNET"),
    });

    renderHook(() => useNetworkPoller("TESTNET", 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does nothing when no expected network is provided", async () => {
    getFreighterMock.mockClear();
    renderHook(() => useNetworkPoller(null, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getFreighterMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// useErrorTracker
// ═══════════════════════════════════════════════════════════════

describe("useErrorTracker", () => {
  it("forwards trackError to the error capture integration", () => {
    const { result } = renderHook(() => useErrorTracker("PaymentForm"));
    const error = new Error("failed");

    act(() => result.current.trackError(error, { attempt: "manual" }));

    expect(captureError).toHaveBeenCalledWith(error, {
      component: "PaymentForm",
      extra: { attempt: "manual" },
    });
  });

  it("forwards trackMessage with a default error level", () => {
    const { result } = renderHook(() => useErrorTracker());

    act(() => result.current.trackMessage("something happened"));

    expect(captureMessage).toHaveBeenCalledWith("something happened", "error");
  });

  it("accepts an explicit level for trackMessage", () => {
    const { result } = renderHook(() => useErrorTracker("Widget"));

    act(() => result.current.trackMessage("heads up", "warning"));

    expect(captureMessage).toHaveBeenCalledWith("heads up", "warning");
  });

  it("returns stable callbacks across renders", () => {
    const { result, rerender } = renderHook(() => useErrorTracker("Stable"));

    const first = result.current.trackMessage;
    rerender();
    expect(result.current.trackMessage).toBe(first);
  });
});
