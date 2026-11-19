// SPDX-License-Identifier: MIT

/**
 * Issue #823 — Postgres full-text search helpers.
 *
 * Search used to be application-level: `ILIKE` / substring matching that scans
 * the table and cannot rank results. Postgres already provides `tsvector`
 * columns, GIN indexes and `ts_rank`, so the migration
 * `prisma/migrations/20260925120000_add_full_text_search` adds a generated
 * `searchVector` column plus a GIN index to `Payment` and `AuditLog`.
 *
 * Everything here is pure: it builds SQL fragments / parameter arrays, or
 * Prisma `where` objects, and never touches a connection. That keeps the
 * behaviour that matters — which predicate is chosen, how parameters bind, how
 * raw input is sanitised into a tsquery — unit-testable without a database
 * (see `src/__tests__/full-text-search.test.ts`).
 *
 * SECURITY: the search term is never interpolated into SQL. It is bound as a
 * `$n` parameter, and {@link buildTsQuery} strips every character that means
 * something to tsquery syntax, so input like `a & b | !c:*` cannot change the
 * query shape.
 *
 * SQLite has no `tsvector` and no GIN index. The committed schema is
 * PostgreSQL-only, but local development can swap the datasource to SQLite
 * (see the "SQLite ⇄ PostgreSQL notes" in `prisma/schema.prisma`), so
 * {@link buildFallbackWhere} preserves the issue #157 substring semantics for
 * that path. The Postgres path binds {@link buildPostgresMatch} +
 * {@link buildPostgresRank} into a `$queryRaw` call.
 */

import type { Prisma } from "@prisma/client";

export type SearchModel = "Payment" | "AuditLog";
export type SearchBackend = "postgres" | "sqlite";

/** Generated tsvector column shared by both models (see the migration). */
export const SEARCH_VECTOR_COLUMN = "searchVector";

/**
 * Fields the full-text path matches, in descending weight order. Mirrors the
 * `setweight(...)` calls in the migration.
 */
export const SEARCHABLE_COLUMNS: Record<SearchModel, readonly string[]> = {
  Payment: ["transactionHash", "memo", "description"],
  AuditLog: ["actor", "action", "details"],
};

/**
 * Characters that are syntax for `to_tsquery` (or would terminate a token):
 * `&`, `|`, `!`, `<->` / `<` / `>`, parentheses, `:`, `*`, quotes, backslash.
 * Replaced with spaces before tokenising.
 */
const TSQUERY_UNSAFE = /[&|!<>():\*'"\\]/g;

/** Split raw input into bare alphanumeric/underscore terms. */
export function tokenize(input: string): string[] {
  return input
    .replace(TSQUERY_UNSAFE, " ")
    .split(/[^A-Za-z0-9_]+/)
    .filter((term) => term.length > 0);
}

/**
 * Convert a user string into a safe `to_tsquery` argument.
 *
 * - terms are AND-ed, because OR-ing "invoice paid" would match every invoice
 *   *and* every paid row;
 * - the last term is prefix-matched (`:*`) so search-as-you-type still works the
 *   way substring search used to;
 * - returns `null` when there is nothing usable, so the caller drops the
 *   predicate instead of matching every row.
 */
export function buildTsQuery(
  input: string,
  opts: { prefix?: boolean } = {}
): string | null {
  const terms = tokenize(input);
  if (terms.length === 0) return null;
  const prefix = opts.prefix ?? true;
  return terms
    .map((term, i) => (prefix && i === terms.length - 1 ? `${term}:*` : term))
    .join(" & ");
}

/** Strip a pasted `0x` prefix; stored hashes omit it. */
export function normalizeTxHash(input: string): string {
  return input.trim().replace(/^0x/i, "");
}

/**
 * True when the query looks like a transaction hash (or hash prefix): 8+ hex
 * characters. Hash lookups stay EXACT (issue #157) — a partial hash matches too
 * many near-identical values — while everything else is fuzzy.
 */
export function looksLikeTxHash(input: string): boolean {
  const hash = normalizeTxHash(input);
  return hash.length >= 8 && /^[0-9a-fA-F]+$/.test(hash);
}

/** Escape `%`, `_` and `\` so a user term is a literal ILIKE pattern. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface SqlFragment {
  /** SQL predicate/expression text with `$n` placeholders. */
  text: string;
  /** Values bound to `$n`, in order starting at `baseParamIndex`. */
  params: string[];
}

/** Columns to ILIKE-match, casting JSONB `details` to text for AuditLog. */
function ilikeColumns(model: SearchModel): string[] {
  return SEARCHABLE_COLUMNS[model].map((column) =>
    model === "AuditLog" && column === "details"
      ? `"details"::text`
      : `"${column}"`
  );
}

/**
 * Build the WHERE predicate for a search: an indexed tsvector match OR an
 * ILIKE fallback.
 *
 * The ILIKE fallback is deliberate — `tsvector` holds whole lexemes, so a
 * mid-word fragment ("voic" for "invoice") would otherwise stop matching, which
 * the old substring search did match. The exact-hash equality keeps the #157
 * contract that a pasted hash matches exactly.
 *
 * `baseParamIndex` lets the caller splice these `$n` placeholders into a larger
 * statement (e.g. after a cursor parameter).
 */
export function buildPostgresMatch(
  model: SearchModel,
  search: string,
  baseParamIndex = 1
): SqlFragment | null {
  const tsQuery = buildTsQuery(search);
  if (!tsQuery) return null;

  const params: string[] = [tsQuery];
  const predicates: string[] = [
    `"${SEARCH_VECTOR_COLUMN}" @@ to_tsquery('simple', $${baseParamIndex})`,
  ];

  const likeIndex = baseParamIndex + params.length;
  params.push(`%${escapeLikePattern(search.trim())}%`);
  for (const column of ilikeColumns(model)) {
    predicates.push(`${column} ILIKE $${likeIndex} ESCAPE '\\'`);
  }

  if (model === "Payment" && looksLikeTxHash(search)) {
    params.push(normalizeTxHash(search));
    predicates.push(`"transactionHash" = $${baseParamIndex + params.length - 1}`);
  }

  return { text: `(${predicates.join(" OR ")})`, params };
}

/**
 * Build the `ts_rank` expression that orders tsvector hits by relevance. Weights
 * come from the generated column, so an exact-hash/human-text hit outranks a
 * long-description hit.
 */
export function buildPostgresRank(
  _model: SearchModel,
  search: string,
  baseParamIndex = 1
): SqlFragment | null {
  const tsQuery = buildTsQuery(search);
  if (!tsQuery) return null;
  return {
    text: `ts_rank("${SEARCH_VECTOR_COLUMN}", to_tsquery('simple', $${baseParamIndex}))`,
    params: [tsQuery],
  };
}

/**
 * SQLite / local fallback: the Prisma `where` that preserves the pre-#823
 * search semantics exactly. Returns an empty array when there is nothing to
 * search, so callers can omit the `OR` entirely.
 *
 * `details` is JSONB, so it is only matched by the Postgres tsvector path —
 * Prisma cannot portably substring-match a Json column.
 */
export function buildFallbackWhere(
  model: "Payment",
  search: string
): Prisma.PaymentWhereInput[];
export function buildFallbackWhere(
  model: "AuditLog",
  search: string
): Prisma.AuditLogWhereInput[];
export function buildFallbackWhere(
  model: SearchModel,
  search: string
): Prisma.PaymentWhereInput[] | Prisma.AuditLogWhereInput[] {
  if (!search || !search.trim()) return [];
  if (model === "Payment") {
    return [
      { description: { contains: search } },
      { memo: { contains: search, mode: "insensitive" } },
      { transactionHash: { equals: search } },
    ];
  }
  return [
    { actor: { contains: search, mode: "insensitive" } },
    { action: { contains: search, mode: "insensitive" } },
  ];
}
