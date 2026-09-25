import { describe, it, expect } from 'vitest';
import {
  tokenize,
  buildTsQuery,
  buildPostgresMatch,
  buildPostgresRank,
  buildFallbackWhere,
  escapeLikePattern,
  looksLikeTxHash,
  normalizeTxHash,
} from '../lib/full-text-search';

/**
 * Regression tests for the SQLite/Postgres search split.
 *
 * The SQLite path must keep the exact #157 contract (case-insensitive
 * substring match on the human fields, exact match on a transaction hash).
 * The Postgres path adds a ranked tsvector match on top of an ILIKE
 * fallback so mid-word fragments still resolve.
 */
describe('tokenize', () => {
  it('splits on punctuation and drops empties', () => {
    expect(tokenize('invoice, paid!')).toEqual(['invoice', 'paid']);
  });

  it('strips tsquery operators so user input cannot break the query', () => {
    expect(tokenize('a & b | !c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quotes and backslashes', () => {
    expect(tokenize('"alpha beta" \\x')).toEqual(['alpha', 'beta', 'x']);
  });

  it('keeps underscores inside identifiers', () => {
    expect(tokenize('tx_hash_123')).toEqual(['tx_hash_123']);
  });

  it('returns an empty list for whitespace or punctuation only', () => {
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('&|!:*')).toEqual([]);
  });
});

describe('buildTsQuery', () => {
  it('ANDs terms and prefix-matches the last one', () => {
    expect(buildTsQuery('invoice paid')).toBe('invoice & paid:*');
  });

  it('omits the prefix operator when disabled', () => {
    expect(buildTsQuery('alpha beta', { prefix: false })).toBe('alpha & beta');
  });

  it('returns null when there is nothing to search for', () => {
    expect(buildTsQuery('')).toBeNull();
  });

  it('neutralises operator injection', () => {
    expect(buildTsQuery('a&b')).toBe('a & b:*');
  });
});

describe('buildPostgresMatch', () => {
  it('binds a tsquery and an escaped ILIKE pattern', () => {
    const frag = buildPostgresMatch('Payment', 'invoice');
    expect(frag).not.toBeNull();
    expect(frag!.params).toEqual(['invoice:*', '%invoice%']);
    expect(frag!.text).toContain('to_tsquery');
    expect(frag!.text).toContain('ILIKE');
  });

  it('returns null for an empty search', () => {
    expect(buildPostgresMatch('Payment', '  ')).toBeNull();
  });

  it('adds an exact-match predicate for a pasted transaction hash', () => {
    const hash = 'a'.repeat(64);
    const frag = buildPostgresMatch('Payment', hash);
    expect(frag!.params).toContain(hash);
  });

  it('normalises a 0x-prefixed hash to the stored form', () => {
    const hash = 'a'.repeat(64);
    const frag = buildPostgresMatch('Payment', `0x${hash}`);
    expect(frag!.params).toContain(hash);
    expect(frag!.params).not.toContain(`0x${hash}`);
  });

  it('respects baseParamIndex for splicing into a larger statement', () => {
    const frag = buildPostgresMatch('AuditLog', 'login', 4);
    expect(frag!.text).toContain('$4');
    expect(frag!.text).toContain('$5');
  });
});

describe('buildPostgresRank', () => {
  it('ranks tsvector hits ahead of substring-only hits', () => {
    const frag = buildPostgresRank('Payment', 'invoice');
    expect(frag!.text).toContain('ts_rank');
    expect(frag!.params).toEqual(['invoice']);
  });

  it('returns null for an empty search', () => {
    expect(buildPostgresRank('Payment', '')).toBeNull();
  });
});

describe('buildFallbackWhere', () => {
  it('keeps the #157 substring semantics for SQLite payments', () => {
    const where = buildFallbackWhere('Payment', 'inv');
    expect(where).toEqual([
      { memo: { contains: 'inv', mode: 'insensitive' } },
      { transactionHash: { equals: 'inv' } },
      { description: { contains: 'inv' } },
    ]);
  });

  it('searches the audit fields for non-payment models', () => {
    const where = buildFallbackWhere('AuditLog', 'login');
    expect(where).toEqual([
      { details: { contains: 'login', mode: 'insensitive' } },
      { actor: { contains: 'login', mode: 'insensitive' } },
      { action: { contains: 'login', mode: 'insensitive' } },
    ]);
  });

  it('returns no predicates for an empty search', () => {
    expect(buildFallbackWhere('Payment', '   ')).toEqual([]);
  });
});

describe('escaping and hash detection', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLikePattern('50%_x')).toBe('50\\%\\_x');
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
  });

  it('detects a 64-char hash with or without the 0x prefix', () => {
    const hash = 'a'.repeat(64);
    expect(looksLikeTxHash(hash)).toBe(true);
    expect(looksLikeTxHash(`0x${hash}`)).toBe(true);
  });

  it('treats ordinary words as free text', () => {
    expect(looksLikeTxHash('invoice paid')).toBe(false);
    expect(looksLikeTxHash('0x123')).toBe(false);
  });

  it('normalises a pasted hash', () => {
    expect(normalizeTxHash('  0xABC  ')).toBe('ABC');
  });
});
