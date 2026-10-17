"use client";
// SPDX-License-Identifier: MIT

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { onSessionRevoked } from "@/lib/session-lifecycle";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,        // 30 seconds before refetch
        gcTime: 5 * 60_000,       // 5 min garbage collection
        retry: 2,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: reuse to avoid losing cached data
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  // Purge every cached query when the wallet session ends (issue #1379). The
  // balance/transaction caches are keyed per query, not per wallet, so without
  // this a subsequent wallet on a shared machine could read the previous
  // account's cached data. `clear()` drops queries AND mutations.
  useEffect(
    () => onSessionRevoked(() => queryClient.clear()),
    [queryClient]
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
