// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { REQUEST_ID_HEADER, withRequestId } from '@/lib/request-id';

describe('request-id', () => {
  describe('REQUEST_ID_HEADER', () => {
    it('is X-Request-Id', () => {
      expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
    });
  });

  describe('withRequestId', () => {
    it('sets the request ID header on a response', () => {
      const response = new Response('ok', { status: 200 });
      const id = 'abc-123-def';
      const result = withRequestId(response, id);
      expect(result.headers.get('X-Request-Id')).toBe(id);
    });

    it('returns the same response object', () => {
      const response = new Response('ok');
      const result = withRequestId(response, 'test-id');
      expect(result).toBe(response);
    });

    it('overwrites existing request ID header', () => {
      const response = new Response('ok', {
        headers: { 'X-Request-Id': 'old-id' },
      });
      const result = withRequestId(response, 'new-id');
      expect(result.headers.get('X-Request-Id')).toBe('new-id');
    });

    it('works with error responses', () => {
      const response = new Response('error', { status: 500 });
      const result = withRequestId(response, 'err-id');
      expect(result.headers.get('X-Request-Id')).toBe('err-id');
      expect(result.status).toBe(500);
    });

    it('preserves other headers', () => {
      const response = new Response('ok', {
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' },
      });
      const result = withRequestId(response, 'id');
      expect(result.headers.get('Content-Type')).toBe('application/json');
      expect(result.headers.get('X-Custom')).toBe('value');
      expect(result.headers.get('X-Request-Id')).toBe('id');
    });
  });

  describe('getRequestId', () => {
    it('returns a UUID when headers() not available', async () => {
      const { getRequestId } = await import('@/lib/request-id');
      // In test env, next/headers will throw, so we get a random UUID
      const id = await getRequestId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      // UUID format
      expect(id).toMatch(/^[0-9a-f-]+$/);
    });
  });
});
