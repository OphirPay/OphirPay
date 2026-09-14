"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback, useRef } from "react";

interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
}

interface RetryState {
  attempt: number;
  error: Error | null;
  isRetrying: boolean;
}

/**
 * Exponential backoff retry hook for API calls and async operations.
 * Each retry waits longer: baseDelay * 2^attempt, capped at maxDelay.
 * Returns { attempt, error, isRetrying, execute, cancel }.
 *
 * @example
 * Retry a best-effort Horizon submission with a cancel affordance:
 *
 * ```tsx
 * function SubmitPayment({ xdr }: { xdr: string }) {
 *   const { execute, cancel, isRetrying, error } = useRetry();
 *   const [hash, setHash] = useState<string | null>(null);
 *
 *   const submit = async () => {
 *     const result = await execute((signal) => submitSignedTxWithSignal(xdr, signal));
 *     setHash(result.hash);
 *   };
 *
 *   return (
 *     <>
 *       <button onClick={submit} disabled={isRetrying}>Submit</button>
 *       {isRetrying && <button onClick={cancel}>Cancel</button>}
 *       {error && <p>{error.message}</p>}
 *       {hash && <p>Hash: {hash}</p>}
 *     </>
 *   );
 * }
 * ```
 */
export function useRetry(options: RetryOptions = {}) {
  const { maxAttempts = 3, baseDelay = 1000, maxDelay = 30000 } = options;

  const [state, setState] = useState<RetryState>({
    attempt: 0,
    error: null,
    isRetrying: false,
  });

  const controllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      setState({ attempt: 0, error: null, isRetrying: false });

      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        try {
          controllerRef.current?.abort();
          controllerRef.current = new AbortController();

          const result = await fn(controllerRef.current.signal);
          setState({ attempt, error: null, isRetrying: false });
          return result;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));

          if (attempt === maxAttempts) {
            setState({ attempt, error, isRetrying: false });
            throw error;
          }

          setState({ attempt: attempt + 1, error, isRetrying: true });

          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw new Error("Max retries exceeded");
    },
    [maxAttempts, baseDelay, maxDelay]
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState({ attempt: 0, error: null, isRetrying: false });
  }, []);

  return { ...state, execute, cancel };
}
