// SPDX-License-Identifier: MIT
// Targeted branch-coverage tests for api-response.ts

import { describe, it, expect } from 'vitest';
import { jsonSafe, errorResponse, successResponse, handleApiError, notFoundError, serverError, unauthorizedError, rateLimitError, conflictError, badRequestError, validationError } from '@/lib/api-response';
import { z } from 'zod';

describe('jsonSafe branches', () => {
  it('handles BigInt within safe range', () => {
    expect(jsonSafe(BigInt(42))).toBe(42);
  });

  it('handles BigInt below Number.MIN_SAFE_INTEGER', () => {
    const big = BigInt(Number.MIN_SAFE_INTEGER) - BigInt(1);
    expect(typeof jsonSafe(big)).toBe('string');
  });

  it('handles BigInt above Number.MAX_SAFE_INTEGER', () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
    expect(typeof jsonSafe(big)).toBe('string');
  });

  it('handles BigInt at boundary MAX_SAFE_INTEGER', () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER);
    expect(jsonSafe(big)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles Date objects', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const result = jsonSafe(date);
    expect(typeof result).toBe('string');
    expect(result).toContain('2026-01-15');
  });

  it('handles arrays recursively', () => {
    const input = [BigInt(1), BigInt(2), 'hello'];
    const result = jsonSafe(input) as unknown[];
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(1);
    expect(result[2]).toBe('hello');
  });

  it('handles nested objects', () => {
    const input = { a: BigInt(10), b: { c: BigInt(20) } };
    const result = jsonSafe(input) as { a: number; b: { c: number } };
    expect(result.a).toBe(10);
    expect(result.b.c).toBe(20);
  });

  it('handles null', () => {
    expect(jsonSafe(null)).toBeNull();
  });

  it('handles plain strings', () => {
    expect(jsonSafe('hello')).toBe('hello');
  });

  it('handles numbers', () => {
    expect(jsonSafe(42)).toBe(42);
  });

  it('handles booleans', () => {
    expect(jsonSafe(true)).toBe(true);
    expect(jsonSafe(false)).toBe(false);
  });
});

describe('handleApiError branches', () => {
  it('handles Zod errors', () => {
    const zodError = new z.ZodError([
      { code: z.ZodIssueCode.custom, path: ['email'], message: 'Required' },
    ]);
    const res = handleApiError(zodError);
    expect(res.status).toBe(400);
  });

  it('handles Prisma errors via constructor name check', () => {
    const err = new Error('Unique constraint failed');
    Object.defineProperty(err, 'constructor', {
      value: { name: 'PrismaClientKnownRequestError' },
      configurable: true,
    });
    (err as { code?: string }).code = 'P2002';
    const res = handleApiError(err);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('handles Prisma fallback code path', () => {
    const err = { code: 'P2025', message: 'Not found' };
    const res = handleApiError(err);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('handles generic errors in test env', () => {
    const err = new Error('Debug info');
    const res = handleApiError(err);
    expect(res.status).toBe(500);
  });

  it('handles non-Error objects', () => {
    const res = handleApiError('string error');
    expect(res.status).toBe(500);
  });
});

describe('errorResponse branches', () => {
  it('includes details when provided', async () => {
    const res = errorResponse('BAD_REQUEST', 'msg', 400, { field: 'email' });
    const json = await res.json();
    expect(json.error.details).toBeDefined();
  });

  it('omits details when not provided', async () => {
    const res = errorResponse('NOT_FOUND', 'msg', 404);
    const json = await res.json();
    expect(json.error.details).toBeUndefined();
  });
});

describe('successResponse branches', () => {
  it('sets Cache-Control header when cacheHeader provided', () => {
    const res = successResponse({ ok: true }, undefined, 200, 'public, max-age=60');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('does not set Cache-Control when no cacheHeader', () => {
    const res = successResponse({ ok: true });
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});

describe('helper response functions', () => {
  it('notFoundError with custom resource', async () => {
    const res = notFoundError('Payment');
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
    expect(json.error.message).toContain('Payment');
    expect(res.status).toBe(404);
  });

  it('notFoundError with default', async () => {
    const res = notFoundError();
    const json = await res.json();
    expect(json.error.message).toContain('Resource');
  });

  it('serverError with custom message', async () => {
    const res = serverError('Custom error');
    const json = await res.json();
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(json.error.message).toBe('Custom error');
  });

  it('serverError with default', async () => {
    const res = serverError();
    const json = await res.json();
    expect(json.error.message).toBe('Internal server error');
  });

  it('unauthorizedError with custom message', async () => {
    const res = unauthorizedError('Bad token');
    const json = await res.json();
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(json.error.message).toBe('Bad token');
  });

  it('rateLimitError with default', async () => {
    const res = rateLimitError();
    const json = await res.json();
    expect(json.error.code).toBe('RATE_LIMITED');
  });

  it('conflictError', async () => {
    const res = conflictError('Already exists');
    const json = await res.json();
    expect(json.error.code).toBe('CONFLICT');
  });

  it('badRequestError', async () => {
    const res = badRequestError('Missing field');
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  it('validationError formats Zod issues', async () => {
    const zodError = new z.ZodError([
      { code: z.ZodIssueCode.custom, path: ['email'], message: 'Required' },
    ]);
    const res = validationError(zodError);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.details).toBeDefined();
  });
});
