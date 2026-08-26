"use client";
// SPDX-License-Identifier: MIT

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";

/**
 * Shared API error type for typed error handling.
 */
export interface ApiError {
  code: string;
  message: string;
}

// ── CSRF token (double-submit cookie pattern) ───────────────────
//
// Mutation API routes verify a `x-csrf-token` header against the
// `__Host-csrf` cookie. The cookie is HttpOnly (not readable by JS),
// so the token is minted server-side at GET /api/csrf, which sets the
// cookie AND returns the token in the body. We cache the in-flight
// promise so concurrent mutations share a single mint (avoiding a
// cookie/header mismatch race) and attach it to every non-GET request.
// The cache is cleared on failure so a later mutation can retry.

let csrfTokenPromise: Promise<string | null> | null = null;

function getCsrfToken(): Promise<string | null> {
  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      try {
        const res = await fetch("/api/csrf", { method: "GET" });
        if (!res.ok) return null;
        const json = (await res.json()) as { token?: string };
        return json.token ?? null;
      } catch {
        return null;
      }
    })().then((token) => {
      // On failure, clear the cache so the next mutation can retry.
      if (token === null) csrfTokenPromise = null;
      return token;
    });
  }
  return csrfTokenPromise;
}

/**
 * Fetch wrapper that throws structured ApiError on non-2xx responses.
 * Automatically attaches the CSRF token to mutation requests, and retries
 * once with a freshly minted token if the cached one is rejected (e.g.
 * cookie expired or rotated server-side).
 */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (isMutation) {
    const token = await getCsrfToken();
    if (token) headers.set("x-csrf-token", token);
  }

  let res = await fetch(url, { ...init, headers });

  // Read the body once so it can be reused for both the CSRF check and the
  // error path — consuming the stream twice loses the server's error detail.
  let body: { error?: { code?: string; message?: string } } | null = null;

  // The cached token may be stale (24h cookie expiry, server rotation, or a
  // prior failed mint). Mint a fresh one and retry the request once.
  if (res.status === 403 && isMutation) {
    body = await res.json().catch(() => ({}));
    if (body?.error?.code === "CSRF_INVALID") {
      csrfTokenPromise = null;
      const token = await getCsrfToken();
      if (token) {
        headers.set("x-csrf-token", token);
        res = await fetch(url, { ...init, headers });
        body = null; // the retried response has its own body
      }
    }
  }

  if (!res.ok) {
    if (!body) body = await res.json().catch(() => ({}));
    const err: ApiError = {
      code: body?.error?.code ?? `HTTP_${res.status}`,
      message: body?.error?.message ?? `Request failed with status ${res.status}`,
    };
    throw err;
  }

  const json = await res.json();
  return json.data ?? json;
}

/**
 * Shared GET query hook wrapping React Query's useQuery.
 *
 * Pass an optional `queryFn` to read from a non-REST source (e.g. on-chain
 * contract reads via Soroban simulation) while keeping the same cache
 * key/invalidation semantics.
 */
export function useApiQuery<T>(
  key: string[],
  url?: string,
  options?: Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">,
  queryFn?: () => Promise<T>,
) {
  if (process.env.NODE_ENV === "development" && !url && !queryFn) {
    console.warn(
      `useApiQuery [${key.join(",")}]: neither url nor queryFn provided — the query would fetch the root page.`
    );
  }
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: queryFn ?? (() => apiFetch<T>(url ?? "")),
    ...options,
  });
}

export interface ApiMutationOptions {
  /** HTTP method to use. Defaults to POST. */
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * Query keys to invalidate on success. Defaults to ALL queries.
   * Scope this to the mutation's own lists so unrelated (and potentially
   * expensive, e.g. on-chain simulation) queries are not refetched.
   */
  invalidateKeys?: string[][];
}

/**
 * Shared mutation hook. POST by default; pass `method` for DELETE/PUT/PATCH.
 * `url` may be a static string or a function of the mutation body, which is
 * useful for DELETE/PATCH routes that identify the resource in the query
 * string or path (e.g. `/api/webhooks?id=${body.id}`).
 * Automatically invalidates cached queries on success so data refreshes.
 */
export function useApiMutation<TBody, TResponse>(
  url: string | ((body: TBody) => string),
  options?: ApiMutationOptions,
) {
  const queryClient = useQueryClient();
  const method = options?.method ?? "POST";

  return useMutation<TResponse, ApiError, TBody>({
    mutationFn: (body) => {
      const resolvedUrl = typeof url === "function" ? url(body) : url;
      return apiFetch<TResponse>(resolvedUrl, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    onSuccess: () => {
      const keys = options?.invalidateKeys;
      if (keys && keys.length > 0) {
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      } else {
        queryClient.invalidateQueries();
      }
    },
  });
}

export { apiFetch };
