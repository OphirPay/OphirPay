// SPDX-License-Identifier: MIT

/**
 * Simple client-side search utility for filtering arrays of objects.
 * No external dependencies — works entirely in-memory.
 */

type SearchableRecord = Record<string, string | number | undefined | null>;

/**
 * Filter an array of objects by a search query across multiple fields.
 * Case-insensitive substring matching.
 */
export function searchRecords<T extends SearchableRecord>(
  records: T[],
  query: string,
  fields: (keyof T)[]
): T[] {
  if (!query || !query.trim()) return records;
  const q = query.toLowerCase().trim();

  return records.filter((record) =>
    fields.some((field) => {
      const value = record[field];
      if (value == null) return false;
      return String(value).toLowerCase().includes(q);
    })
  );
}

/**
 * Rank search results by relevance (number of matching fields).
 * Higher score = more relevant.
 */
export function rankSearchResults<T extends SearchableRecord>(
  records: T[],
  query: string,
  fields: (keyof T)[]
): (T & { _score: number })[] {
  const q = query.toLowerCase().trim();
  if (!q) return records.map((r) => ({ ...r, _score: 0 }));

  return records
    .map((record) => {
      let score = 0;
      for (const field of fields) {
        const value = record[field];
        if (value == null) continue;
        const str = String(value).toLowerCase();
        if (str === q) score += 10;
        else if (str.startsWith(q)) score += 5;
        else if (str.includes(q)) score += 1;
      }
      return { ...record, _score: score };
    })
    .filter((r) => r._score > 0)
    .sort((a, b) => b._score - a._score);
}
