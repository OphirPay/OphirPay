// SPDX-License-Identifier: MIT

/**
 * Client-side API fetch wrapper with error handling and type safety.
 *
 * Error bodies are normalized through `src/lib/problem-details.ts`, so a route
 * that answers with `application/problem+json` (the payment mutations, see
 * issue #1364) surfaces the same message the legacy envelope would have.
 *
 * Mutating requests attach the double-submit `x-csrf-token` header. The CSRF
 * cookie is HttpOnly (JavaScript cannot read it), so the token is minted by
 * GET /api/csrf, which sets the cookie and returns the token in its body. The
 * in-flight mint is cached so concurrent mutations share one token instead of
 * racing cookie/header pairs.
 */

import { normalizeApiError } from "@/lib/problem-details";

interface ApiClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: { timestamp?: string };
}

type ApiResult<T> = ApiResponse<T> | Record<string, unknown>;

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

let csrfTokenPromise: Promise<string | null> | null = null;

/**
 * Fetch a CSRF token, caching the in-flight request. A failed mint clears the
 * cache so the next mutation retries instead of pinning `null` for the tab's
 * lifetime.
 */
function getCsrfToken(): Promise<string | null> {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch("/api/csrf", { method: "GET" })
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { token?: string };
        return json.token ?? null;
      })
      .catch(() => null)
      .then((token) => {
        if (token === null) csrfTokenPromise = null;
        return token;
      });
  }
  return csrfTokenPromise;
}

/**
 * Create a typed API client for browser-side fetch calls.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl || "";

  async function buildHeaders(init: RequestInit | undefined, isMutation: boolean) {
    const headers = new Headers({
      "Content-Type": "application/json",
      ...options.headers,
      ...(init?.headers ?? {}),
    });

    if (isMutation) {
      const token = await getCsrfToken();
      if (token) headers.set("x-csrf-token", token);
    }

    return headers;
  }

  async function request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const method = (init?.method ?? "GET").toUpperCase();
    const isMutation = MUTATING_METHODS.includes(method);

    let headers = await buildHeaders(init, isMutation);
    let res = await fetch(url, { ...init, headers });

    let json: ApiResult<T> | null = null;

    // A rejected token (expired/rotated cookie) is recoverable: mint a fresh
    // one and retry once. The body is read here and reused below so the
    // server's error detail is never lost to a second stream read.
    if (res.status === 403 && isMutation) {
      json = (await res.json().catch(() => null)) as ApiResult<T> | null;
      if (normalizeApiError(json, res.status).code === "CSRF_INVALID") {
        csrfTokenPromise = null;
        headers = await buildHeaders(init, isMutation);
        res = await fetch(url, { ...init, headers });
        json = null;
      }
    }

    if (!json) {
      json = (await res.json()) as ApiResult<T>;
    }

    // `!res.ok` alone is enough: an error body is either the legacy
    // `{ success: false, error }` envelope or an RFC 7807 problem document
    // (which has no `success` member at all) — see src/lib/problem-details.ts.
    if (!res.ok) {
      const { message } = normalizeApiError(json, res.status);
      throw new Error(message);
    }

    return (json as ApiResponse<T>).data;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
    // Recurring payment pause/resume actions
    pauseRecurring: (id: string) =>
      request<void>(`/recurring/${id}/pause`, { method: "POST" }),
    resumeRecurring: (id: string) =>
      request<void>(`/recurring/${id}/resume`, { method: "POST" }),
  };
}

/** Default API client instance. */
export const api = createApiClient();
