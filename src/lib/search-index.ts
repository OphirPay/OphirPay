// SPDX-License-Identifier: MIT

/**
 * Full-text search and client-side search utility.
 *
 * Provides:
 * 1. In-memory / client-side search and ranking for arrays of records.
 * 2. Postgres full-text query builder for tsvector columns with sensible ranking.
 * 3. Fallback translation for SQLite development where tsvector is unavailable.
 */

import { getDatabaseProvider } from "@/lib/env";
import { Prisma } from "@prisma/client";

export type SearchableRecord = Record<string, string | number | undefined | null>;

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
 * Rank search results by relevance (number of matching fields, exact match > prefix > substring).
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

/**
 * Convert a user search query into a sanitized PostgreSQL `to_tsquery` formatted string.
 * Strips special tsquery punctuation and appends prefix matching `:*` to terms for partial matching.
 */
export function formatTsQuery(query: string): string | null {
  if (!query || !query.trim()) return null;
  // Match alphanumeric tokens or hex strings (like stellar addresses or transaction hashes)
  const tokens = query
    .trim()
    .split(/[\s,;:|&!()<>*+]+/)
    .map((t) => t.trim().replace(/['"\\]/g, ""))
    .filter(Boolean);

  if (tokens.length === 0) return null;

  // Append :* for prefix/partial term matching and join with & (AND)
  return tokens.map((token) => `${token}:*`).join(" & ");
}

/**
 * Check if the active database provider supports native PostgreSQL tsvector full-text search.
 */
export function isPostgresFtsAvailable(): boolean {
  try {
    return getDatabaseProvider() === "postgresql";
  } catch {
    return true;
  }
}

/**
 * Build full-text search criteria for Payment models.
 * On PostgreSQL, returns raw SQL fragments or Prisma filters.
 * On SQLite, falls back to substring / ILIKE-style matching.
 */
export function buildPaymentSearchFilter(search?: string): {
  isPostgres: boolean;
  tsQuery: string | null;
  fallbackOr: Prisma.PaymentWhereInput[] | null;
} {
  if (!search || !search.trim()) {
    return { isPostgres: isPostgresFtsAvailable(), tsQuery: null, fallbackOr: null };
  }

  const isPostgres = isPostgresFtsAvailable();
  const tsQuery = formatTsQuery(search);

  // SQLite and Prisma fallback filters:
  const fallbackOr: Prisma.PaymentWhereInput[] = [
    { description: { contains: search } },
    { memo: { contains: search, mode: "insensitive" } },
    { transactionHash: { equals: search } },
  ];

  return {
    isPostgres,
    tsQuery,
    fallbackOr,
  };
}

/**
 * Build full-text search criteria for AuditLog models.
 * Search targets: actor (A), action (B), details (C).
 */
export function buildAuditLogSearchFilter(search?: string): {
  isPostgres: boolean;
  tsQuery: string | null;
  fallbackOr: Prisma.AuditLogWhereInput[] | null;
} {
  if (!search || !search.trim()) {
    return { isPostgres: isPostgresFtsAvailable(), tsQuery: null, fallbackOr: null };
  }

  const isPostgres = isPostgresFtsAvailable();
  const tsQuery = formatTsQuery(search);

  const fallbackOr: Prisma.AuditLogWhereInput[] = [
    { actor: { contains: search, mode: "insensitive" } },
    { action: { contains: search, mode: "insensitive" } },
  ];

  return {
    isPostgres,
    tsQuery,
    fallbackOr,
  };
}
