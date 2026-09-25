// SPDX-License-Identifier: MIT
/**
 * Issue #823 — Postgres full-text search helpers.
 *
 * The application has two backends:
 *   • Postgres (production / CI with a real DB) — uses the generated
 *     `searchVector` tsvector columns added in
 *     20260830000000_add_full_text_search, matched with `@@`, ranked with
 *     `ts_rank`.
 *   • SQLite (local dev, `prisma db push`) — has no tsvector type, so we
 *     fall back to the substring semantics from #157 (ILIKE / LIKE).
 *
 * Everything in this file is pure: it builds SQL fragments and parameter
 * arrays, or Prisma `where` objects. Nothing here touches a connection, so
 * the behaviour that matters — which predicate is chosen, in what order the
 * parameters bind, how a user's raw query is sanitised into a tsquery — is
 * unit-testable without a database. See src/__tests__/full-text-search.test.ts.
 *
 * SECURITY: the search term is *never* interpolated into SQL. It is either
 * (a) bound as a $n parameter, or (b) encoded into a `to_tsquery` argument
 * that is itself bound. `buildTsQuery` additionally strips every character
 * that has meaning to tsquery syntax, so a term like `a & b | !c:*` cannot
 * alter the query shape.
 */

export type SearchBackend = "postgres" | "sqlite";

export interface SearchOptions {
  /** Raw user-supplied query string. */
  search?: string | null;
  /** Backend to build for. Defaults to "postgres". */
  backend?: SearchBackend;
}

/** Columns per model. Keep in sync with the generated columns in the migration. */
export const SEARCHABLE_COLUMNS = {
  Payment: ["memo", "description", "transactionHash"],
  AuditLog: ["details", "actor", "action"],
} as const;

export type SearchableModel = keyof typeof SEARCHABLE_COLUMNS;

/**
 * tsquery metacharacters plus characters that would break out of a tsquery
 * token. Reference: Postgres docs, "Text Search Types" — `&`, `|`, `!`,
 * `<->`, parentheses and `:` (weight/prefix separator) are all syntax.
 * Quotes and backslashes are removed so the term cannot terminate early.
 * `*` is kept only via {@link buildTsQuery}'s explicit prefix option.
 */
const TSQUERY_UNSAFE = /[&|!<>():\*'"\\]/g;

/** Split a raw string into bare alphanumeric/underscore terms. */
export function tokenize(input: string): string[] {
  return input
    .replace(TSQUERY_UNSAFE, " ")
    .split(/[^A-Za-z0-9_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Distinguish "the user is pasting a transaction hash" from "the user is
 * typing words". A 64-char hex string is a hash (or a hash prefix); anything
 * else is treated as free text. This is what preserves the #157 contract
 * that hash lookup is exact and word lookup is fuzzy.
 */
export function looksLikeTxHash(input: string): boolean {
  const t = normalizeTxHash(input);
  return t.length >= 8 && /^[0-9a-fA-F]+$/.test(t);
}

/**
 * Strip a leading `0x` and surrounding whitespace so a pasted
 * `0x<64 hex>` and a bare `<64 hex>` are treated as the same value.
 * Stored hashes omit the prefix, so the exact-match parameter must too.
 */
export function normalizeTxHash(input: string): string {
  return input.trim().replace(/^0x/i, "");
}

/**
 * Convert a user string into a safe tsquery string.
 *
 * - multiple words are AND-ed, because a search that OR-s them makes
 *   "invoice paid" match every invoice *and* every paid row;
 * - the final term gets `:*` (prefix match) so search-as-you-type works,
 *   which is the behaviour the previous substring search provided;
 * - returns null when the input yields no usable terms (caller then omits
 *   the predicate entirely rather than matching everything).
 */
export function buildTsQuery(
  input: string,
  opts: { prefix?: boolean } = {}
): string | null {
  const tokens = tokenize(input);
  if (tokens.length === 0) return null;

  const prefix = opts.prefix ?? true;
  return tokens
    .map((t, i) => (prefix && i === tokens.length - 1 ? `${t}:*` : t))
    .join(" & ");
}

/** Escape `%` and `_` for a LIKE/ILIKE pattern. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Backend A — Prisma `where` for the SQLite dev fallback (#157 semantics)
// ---------------------------------------------------------------------------

/**
 * Reproduces the existing substring behaviour exactly. Kept as the fallback
 * so a developer on SQLite sees the same results as before this change.
 */
export function buildFallbackWhere(
  model: SearchableModel,
  search: string
): Record<string, unknown>[] {
  const term = search.trim();
  if (term === "") return [];

  if (model === "Payment") {
    return [
      { memo: { contains: term, mode: "insensitive" } },
      // Exact match only — a partial hash match is meaningless to a user.
      { transactionHash: { equals: term } },
      // No `mode` here: this mirrors #157, where description stayed
      // case-sensitive on the SQLite path.
      { description: { contains: term } },
    ];
  }

  return [
    { details: { contains: term, mode: "insensitive" } },
    { actor: { contains: term, mode: "insensitive" } },
    { action: { contains: term, mode: "insensitive" } },
  ];
}

// ---------------------------------------------------------------------------
// Backend B — raw SQL predicates for Postgres
// ---------------------------------------------------------------------------

export interface SqlFragment {
  /** Safe to concatenate into a larger statement; contains only $n refs. */
  text: string;
  /** Values in $1..$n order, relative to this fragment's own numbering. */
  params: unknown[];
}

/**
 * Predicate + parameters for a Postgres full-text match.
 *
 * `baseParamIndex` lets the caller splice this into an already-parameterised
 * statement (prisma.$queryRaw`... AND ${frag.text}` style pipelines), so
 * numbering continues from whatever the caller already bound.
 *
 * Returns null when there is nothing to search for.
 */
export function buildPostgresMatch(
  model: SearchableModel,
  search: string,
  baseParamIndex = 1
): SqlFragment | null {
  const term = search.trim();
  if (term === "") return null;

  const col = model === "Payment" ? "Payment" : "AuditLog";
  const prefix = lookPrefixOnly(term);
  const tsq = buildTsQuery(term, { prefix: true });
  const like = `%${escapeLikePattern(term)}%`;

  // Two predicates OR-ed:
  //   1. tsvector @@ tsquery — the ranked path from the issue.
  //   2. trigram/substring ILIKE — covers mid-word fragments that a
  //      stemmed tsquery cannot match, preserving #157 behaviour.
  // A transaction hash is additionally matched by exact equality so
  // `looksLikeTxHash` lookups are never at the mercy of a stemmer.
  const parts: string[] = [
    `${col}."searchVector" @@ to_tsquery('english', $${baseParamIndex})`,
    `${col}."searchText" ILIKE $${baseParamIndex + 1} ESCAPE '\\'`,
  ];
  const params: unknown[] = [tsq, like];

  if (prefix && model === "Payment") {
    parts.push(`"Payment"."transactionHash" = $${baseParamIndex + 2}`);
    params.push(normalizeTxHash(term));
  }

  return { text: `(${parts.join(" OR ")})`, params };
}

/** True when the term is a bare hash-ish token rather than prose. */
function lookPrefixOnly(input: string): boolean {
  return looksLikeTxHash(input);
}

/**
 * ORDER BY fragment that ranks full-text hits ahead of substring-only hits.
 * Parameterised identically: the tsquery is bound once more.
 */
export function buildPostgresRank(
  model: SearchableModel,
  search: string,
  baseParamIndex = 1
): SqlFragment | null {
  const term = search.trim();
  if (term === "") return null;
  const tsq = buildTsQuery(term, { prefix: false });
  if (tsq === null) return null;

  const col = model === "Payment" ? "Payment" : "AuditLog";
  return {
    text: `ts_rank(${col}."searchVector", to_tsquery('english', $${baseParamIndex})) DESC, ${col}."createdAt" DESC`,
    params: [tsq],
  };
}

/**
 * Convenience for the route layer: given a request's search string, produce
 * the argument to spread into `ORDER BY` plus the predicate, for the
 * requested backend. Pure — no I/O.
 */
export function buildSearch(
  model: SearchableModel,
  options: SearchOptions
): {
  backend: SearchBackend;
  fallbackWhere: Record<string, unknown>[] | null;
  match: SqlFragment | null;
  rank: SqlFragment | null;
} {
  const backend = options.backend ?? "postgres";
  const raw = options.search ?? "";
  const term = raw.trim();

  if (term === "") {
    return { backend, fallbackWhere: null, match: null, rank: null };
  }

  if (backend === "sqlite") {
    return {
      backend,
      fallbackWhere: buildFallbackWhere(model, term),
      match: null,
      rank: null,
    };
  }

  return {
    backend,
    fallbackWhere: null,
    match: buildPostgresMatch(model, term),
    rank: buildPostgresRank(model, term),
  };
}
