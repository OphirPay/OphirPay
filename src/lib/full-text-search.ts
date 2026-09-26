// SPDX-License-Identifier: MIT

/**
 * PostgreSQL Full-Text Search utilities with GIN indexing and SQLite fallback (Issue #823).
 *
 * Provides query tokenization, sanitization, prefix-matching tsquery builders,
 * exact transaction hash prioritization, and fallback predicates for local SQLite development.
 */

import type { Prisma } from "@prisma/client";

/**
 * Strips special tsquery operators (&, |, !, (, ), :, *, ', ", \) and characters
 * that could produce syntax errors in PostgreSQL to_tsquery().
 */
export function tokenize(query: string): string[] {
  if (!query || typeof query !== "string") return [];
  // Strip tsquery control characters
  const sanitized = query.replace(/[&|!():*'\"\\/<>+~^]/g, " ");
  return sanitized
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Builds a prefix-matched PostgreSQL to_tsquery string.
 * Example: "stellar invoice" -> "'stellar':* & 'invoice':*"
 * Allows partial terms (e.g. "inv" matches "invoice").
 */
export function buildTsQuery(query: string): string {
  const tokens = tokenize(query);
  if (tokens.length === 0) return "";
  return tokens.map((token) => `'${token.replace(/'/g, "''")}':*`).join(" & ");
}

/**
 * Determines whether a search string resembles a 64-character hexadecimal transaction hash.
 */
export function looksLikeTxHash(query: string): boolean {
  if (!query) return false;
  const trimmed = query.trim();
  return /^[0-9a-fA-F]{64}$/.test(trimmed);
}

/**
 * Normalizes a transaction hash by trimming and canonicalizing case.
 */
export function normalizeTxHash(hash: string): string {
  return hash.trim();
}

/**
 * Escapes SQL wildcard characters (%) and (_) for safe ILIKE substring patterns.
 */
export function escapeLikePattern(pattern: string): string {
  return pattern.replace(/([%_\\])/g, "\\$1");
}

/**
 * Builds the fallback Prisma `where.OR` array for SQLite and in-memory development,
 * preserving existing Issue #157 search semantics (memo ILIKE, description substring, exact txHash).
 */
export function buildFallbackWhere(query: string): Prisma.PaymentWhereInput["OR"] {
  if (!query || !query.trim()) return undefined;
  const trimmed = query.trim();
  return [
    { description: { contains: trimmed } },
    { memo: { contains: trimmed, mode: "insensitive" } },
    { transactionHash: { equals: trimmed } },
  ];
}

/**
 * Builds the fallback Prisma `where.OR` array for AuditLog search on SQLite.
 */
export function buildAuditLogFallbackWhere(query: string): Prisma.AuditLogWhereInput["OR"] {
  if (!query || !query.trim()) return undefined;
  const trimmed = query.trim();
  return [
    { actor: { contains: trimmed, mode: "insensitive" } },
    { action: { contains: trimmed, mode: "insensitive" } },
  ];
}

/**
 * Returns SQL fragment for ranked relevance scoring.
 * Assigns top priority (score 1000.0) to exact transaction hash matches,
 * followed by PostgreSQL ts_rank against the GIN-indexed searchVector.
 */
export function buildPostgresRankExpression(
  searchVectorColumn: string,
  tsQueryParam: string,
  exactTxHashParam?: string
): string {
  if (exactTxHashParam) {
    return `CASE WHEN "transactionHash" = ${exactTxHashParam} THEN 1000.0 ELSE ts_rank("${searchVectorColumn}", to_tsquery('english', ${tsQueryParam})) END`;
  }
  return `ts_rank("${searchVectorColumn}", to_tsquery('english', ${tsQueryParam}))`;
}

/**
 * Returns SQL predicate matching either the GIN-indexed tsvector or an exact hash match.
 */
export function buildPostgresMatchExpression(
  searchVectorColumn: string,
  tsQueryParam: string,
  exactTxHashParam?: string
): string {
  if (exactTxHashParam) {
    return `("${searchVectorColumn}" @@ to_tsquery('english', ${tsQueryParam}) OR "transactionHash" = ${exactTxHashParam})`;
  }
  return `"${searchVectorColumn}" @@ to_tsquery('english', ${tsQueryParam})`;
}
