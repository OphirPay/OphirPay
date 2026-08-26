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
  };
}

/** Default API client instance. */
export const api = createApiClient();
