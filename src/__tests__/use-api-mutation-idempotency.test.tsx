// SPDX-License-Identifier: MIT

/**
 * The dashboard's own mutations must send an `Idempotency-Key` (issue #1440).
 *
 * Making the header mandatory on `POST /api/payments` and friends would break
 * the send flow if `useApiMutation` did not attach one, so this pins both
 * halves of the contract:
 *
 *   • every mutation carries a key of at least the server's minimum length
 *   • each logical call gets a fresh key (a user-initiated repeat must not be
 *     mistaken for a replay)
 *   • the CSRF retry reuses the same key, so a retried request is still one
 *     operation rather than a second payment
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useApiMutation } from "@/hooks/useApiQuery";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;

function mutationCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url]) => String(url) === "/api/payments"
  ) as [string, RequestInit][];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useApiMutation — Idempotency-Key", () => {
  it("sends a unique key on each mutation", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url) === "/api/csrf") return jsonResponse({ token: "csrf-token" });
      return jsonResponse({ success: true, data: { id: "p1" } }, 201);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useApiMutation("/api/payments"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ amount: 25 });
      await result.current.mutateAsync({ amount: 30 });
    });

    const calls = mutationCalls(fetchMock);
    expect(calls).toHaveLength(2);

    const keys = calls.map(([, init]) => (init.headers as Headers).get("Idempotency-Key"));
    for (const key of keys) {
      // idempotencyKeySchema requires 8–255 characters.
      expect(key).toBeTruthy();
      expect(key!.length).toBeGreaterThanOrEqual(8);
      expect(key!.length).toBeLessThanOrEqual(255);
    }
    // Two deliberate submits are two operations, never one replay.
    expect(new Set(keys).size).toBe(2);
  });

  it("reuses the key when the CSRF token is refreshed and the request retried", async () => {
    let csrfMints = 0;
    // The client caches the CSRF token process-wide (with good reason), so the
    // scenario is driven by what the server accepts rather than by mint count:
    // only the most recently minted token is valid, making the first POST a
    // stale-token 403 and its retry a success.
    let acceptedToken: string | null = null;
    // Snapshot the headers *as sent*: `apiFetch` reuses (and mutates) the same
    // Headers instance for the retry, so reading it after the fact would show
    // the retried values for both calls.
    const sentPerAttempt: { key: string | null; csrf: string | null }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === "/api/csrf") {
        csrfMints += 1;
        acceptedToken = `csrf-token-${csrfMints}`;
        return jsonResponse({ token: acceptedToken });
      }
      const headers = new Headers(init?.headers);
      const sent = headers.get("x-csrf-token");
      sentPerAttempt.push({
        key: headers.get("Idempotency-Key"),
        csrf: sent,
      });
      if (sent !== acceptedToken) {
        return jsonResponse(
          { success: false, error: { code: "CSRF_INVALID", message: "stale" } },
          403
        );
      }
      return jsonResponse({ success: true, data: { id: "p2" } }, 201);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useApiMutation("/api/payments"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ amount: 25 });
    });

    expect(sentPerAttempt).toHaveLength(2);
    const [first, second] = sentPerAttempt;

    // One operation, two HTTP attempts: the retry keeps the key…
    expect(first.key).toBeTruthy();
    expect(second.key).toBe(first.key);
    // …while the CSRF token really was refreshed.
    expect(csrfMints).toBeGreaterThanOrEqual(1);
    expect(second.csrf).not.toBe(first.csrf);
  });
});
