// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";

/**
 * Debounces a value by `delay` milliseconds.
 * Returns the debounced value that only updates after the user stops changing it.
 *
 * @example
 * Debounce a search input so an API call only happens once the user stops typing:
 *
 * ```tsx
 * function TransactionSearch() {
 *   const [query, setQuery] = useState("");
 *   const debouncedQuery = useDebounce(query, 400);
 *
 *   const { data } = useApiQuery<Payment[]>(
 *     ["payments", debouncedQuery],
 *     debouncedQuery ? `/api/payments?search=${debouncedQuery}` : undefined,
 *     { enabled: debouncedQuery.length > 0 },
 *   );
 *
 *   return (
 *     <input
 *       value={query}
 *       onChange={(e) => setQuery(e.target.value)}
 *       placeholder="Search transactions…"
 *     />
 *   );
 * }
 * ```
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
