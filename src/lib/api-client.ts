// SPDX-License-Identifier: MIT

/**
 * Client-side API fetch wrapper with automatic CSRF token management,
 * error handling, and type safety.
 */

export interface ApiClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  csrfEndpoint?: string;
  fetchImpl?: typeof fetch;
}

interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: { timestamp?: string };
}

interface ApiError {
  success: false;
  error: { code: string; message: string };
}

type ApiResult<T> = ApiResponse<T> | ApiError;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hasApiKeyHeader(headers: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "x-api-key" && Boolean(value)) return true;
    if (lower === "authorization" && /^bearer\s+\S+/i.test(value)) return true;
  }
  return false;
}

function hasExplicitCsrfHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === "x-csrf-token" && Boolean(headers[key])
  );
}

function normalizeHeaders(
  headersInit?: HeadersInit
): Record<string, string> {
  if (!headersInit) return {};
  if (headersInit instanceof Headers) {
    const out: Record<string, string> = {};
    headersInit.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headersInit)) {
    return Object.fromEntries(headersInit);
  }
  return { ...headersInit };
}

/**
 * Create a typed API client for browser-side fetch calls.
 * Automatically retrieves and attaches `x-csrf-token` on mutating requests
 * unless authenticated with an API key (`Authorization: Bearer ...` or `x-api-key`).
 */
export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl || "";
  const csrfEndpoint = options.csrfEndpoint || "/api/csrf";
  const fetchFn = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let cachedCsrfToken: string | null = null;
  let inflightCsrfPromise: Promise<string | null> | null = null;

  async function fetchCsrfToken(forceRefresh = false): Promise<string | null> {
    if (cachedCsrfToken && !forceRefresh) {
      return cachedCsrfToken;
    }
    if (inflightCsrfPromise && !forceRefresh) {
      return inflightCsrfPromise;
    }

    inflightCsrfPromise = (async () => {
      try {
        const res = await fetchFn(`${baseUrl}${csrfEndpoint}`, {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { token?: string; data?: { token?: string } };
        const token = body?.token ?? body?.data?.token ?? null;
        if (typeof token === "string" && token.length > 0) {
          cachedCsrfToken = token;
          return token;
        }
        return null;
      } catch {
        return null;
      } finally {
        inflightCsrfPromise = null;
      }
    })();

    return inflightCsrfPromise;
  }

  async function request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const method = (init?.method || "GET").toUpperCase();
    const mergedHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
      ...normalizeHeaders(init?.headers),
    };

    const needsCsrf =
      MUTATING_METHODS.has(method) &&
      !hasApiKeyHeader(mergedHeaders) &&
      !hasExplicitCsrfHeader(mergedHeaders);

    if (needsCsrf) {
      const token = await fetchCsrfToken(false);
      if (token) {
        mergedHeaders["x-csrf-token"] = token;
      }
    }

    let res = await fetchFn(url, {
      ...init,
      method,
      headers: mergedHeaders,
    });

    // If session CSRF token expired or rotated, refresh once and retry
    if (res.status === 403 && needsCsrf) {
      const refreshed = await fetchCsrfToken(true);
      if (refreshed) {
        mergedHeaders["x-csrf-token"] = refreshed;
        res = await fetchFn(url, {
          ...init,
          method,
          headers: mergedHeaders,
        });
      }
    }

    const json = (await res.json()) as ApiResult<T>;

    if (!res.ok || !json.success) {
      const err = json as ApiError;
      throw new Error(err.error?.message || `Request failed with status ${res.status}`);
    }

    return (json as ApiResponse<T>).data;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown, init?: RequestInit) =>
      request<T>(path, { ...init, method: "POST", body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown, init?: RequestInit) =>
      request<T>(path, { ...init, method: "PUT", body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown, init?: RequestInit) =>
      request<T>(path, { ...init, method: "PATCH", body: JSON.stringify(body) }),
    delete: <T>(path: string, init?: RequestInit) =>
      request<T>(path, { ...init, method: "DELETE" }),
    // Recurring payment pause/resume actions
    pauseRecurring: (id: string) =>
      request<void>(`/recurring/${id}/pause`, { method: "POST" }),
    resumeRecurring: (id: string) =>
      request<void>(`/recurring/${id}/resume`, { method: "POST" }),
    getCsrfToken: () => fetchCsrfToken(false),
    clearCsrfToken: () => {
      cachedCsrfToken = null;
    },
  };
}

/** Default API client instance. */
export const api = createApiClient();
