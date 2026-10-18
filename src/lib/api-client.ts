// SPDX-License-Identifier: MIT

/**
 * Client-side API fetch wrapper with error handling and type safety.
 */

interface ApiClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
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

let cachedCsrfToken: string | null = null;

/**
 * Get or fetch CSRF token from document.cookie or /api/csrf.
 */
export async function getOrFetchCsrfToken(baseUrl = ""): Promise<string | null> {
  if (typeof document !== "undefined" && typeof document.cookie === "string") {
    const match = document.cookie.match(/(?:^|;\s*)(?:__Host-csrf|csrf|ophir_csrf)=([^;]*)/);
    if (match) {
      cachedCsrfToken = decodeURIComponent(match[1]);
      return cachedCsrfToken;
    }
  }

  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }

  try {
    const res = await fetch(`${baseUrl}/api/csrf`);
    if (res.ok) {
      const data = await res.json();
      const token = data?.csrfToken || data?.token;
      if (token) {
        cachedCsrfToken = token;
        return cachedCsrfToken;
      }
    }
  } catch {
    // Ignore fetch errors during SSR or offline tests
  }

  return null;
}

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
    const method = (init?.method || "GET").toUpperCase();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const token = await getOrFetchCsrfToken(baseUrl);
      if (token) {
        headers["x-csrf-token"] = token;
      }
    }

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          headers[k] = v;
        }
      } else {
        Object.assign(headers, init.headers);
      }
    }

    const res = await fetch(url, {
      ...init,
      headers,
    });

    const json = (await res.json()) as ApiResult<T>;

    if (!res.ok || !json.success) {
      const err = json as ApiError;
      throw new Error(err.error?.message || `Request failed with status ${res.status}`);
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
