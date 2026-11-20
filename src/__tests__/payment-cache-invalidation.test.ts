// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { useApiMutation } from "@/hooks/useApiQuery";
import React from "react";

describe("payment cache invalidation", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("invalidates balance and transaction queries after successful payment execution", async () => {
    // Mock the fetch to simulate successful payment
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "payment-123" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: "test-csrf-token" }),
      });

    // Pre-populate the cache with balance and transaction data
    queryClient.setQueryData(["balances"], { amount: 1000 });
    queryClient.setQueryData(["transactions"], [{ id: "tx-1" }]);

    // Spy on invalidateQueries
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useApiMutation<{ amount: number }, { id: string }>(
          "/api/payments/execute",
          {
            invalidateKeys: [["balances"], ["transactions"]],
          }
        ),
      { wrapper }
    );

    // Execute the payment mutation
    await result.current.mutateAsync({ amount: 100 });

    // Verify invalidateQueries was called for both keys
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["balances"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["transactions"] });
  });

  it("removes stale data from cache when balance queries are invalidated", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "payment-456" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: "test-csrf-token" }),
      });

    // Pre-populate cache
    const initialBalance = { amount: 5000 };
    queryClient.setQueryData(["balances"], initialBalance);

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useApiMutation<{ amount: number }, { id: string }>(
          "/api/payments/execute",
          {
            invalidateKeys: [["balances"]],
          }
        ),
      { wrapper }
    );

    // Verify cache contains data before mutation
    expect(queryClient.getQueryData(["balances"])).toEqual(initialBalance);

    // Execute mutation
    await result.current.mutateAsync({ amount: 500 });

    // After invalidation, the query is marked stale
    const queryState = queryClient.getQueryState(["balances"]);
    expect(queryState?.isInvalidated).toBe(true);
  });

  it("calls invalidateQueries with correct query keys matching payment-related data", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "payment-789" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: "test-csrf-token" }),
      });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useApiMutation<{ amount: number }, { id: string }>(
          "/api/payments/execute",
          {
            invalidateKeys: [["balances"], ["transactions"], ["payment-detail"]],
          }
        ),
      { wrapper }
    );

    await result.current.mutateAsync({ amount: 250 });

    // Verify all expected keys were invalidated
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: ["balances"] });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: ["transactions"] });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: ["payment-detail"] });
  });

  it("invalidates all queries when no specific keys are provided", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: "payment-999" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: "test-csrf-token" }),
      });

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useApiMutation<{ amount: number }, { id: string }>(
          "/api/payments/execute"
          // no invalidateKeys provided, should invalidate all
        ),
      { wrapper }
    );

    await result.current.mutateAsync({ amount: 100 });

    // When no specific keys are provided, invalidateQueries is called without queryKey
    expect(invalidateSpy).toHaveBeenCalledWith();
  });
});
