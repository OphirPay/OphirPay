// SPDX-License-Identifier: MIT

/**
 * Client-side API fetch wrapper with error handling and type safety.
 *
 * Error bodies are normalized through `src/lib/problem-details.ts`, so a route
 * that answers with `application/problem+json` (the payment mutations, see
 * issue #1364) surfaces the same message the legacy envelope would have.
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

/**
 * Create a typed API client for browser-side fetch calls.
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl || "";

  async function request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        ...init?.headers,
      },
      ...init,
    });

    const json = (await res.json()) as ApiResult<T>;

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
