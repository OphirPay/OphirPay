/**
 * Shared timeout and size limits for outbound fetches.
 */
export const FETCH_TIMEOUT_MS = 5000; // 5 seconds
export const FETCH_SIZE_LIMIT = 1024 * 1024; // 1 MB

/**
 * Wrapper around fetch that enforces timeout and size limits.
 * @param url
 * @param options
 */
export async function fetchWithTimeout(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
    sizeLimit?: number;
  } = {}
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = options.timeout ?? FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      return null;
    }

    let receivedLength = 0;
    let chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedLength += value.length;
        if (receivedLength > (options.sizeLimit ?? FETCH_SIZE_LIMIT)) {
          // Exceeded size limit
          return null;
        }
        chunks.push(value);
      }
    }
    const chunksAll = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      chunksAll.set(chunk, position);
      position += chunk.length;
    }
    return new TextDecoder("utf-8").decode(chunksAll);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
