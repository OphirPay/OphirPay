// SPDX-License-Identifier: MIT
// Tests for validation-schemas.ts validateBody function

import { describe, it, expect } from 'vitest';
import { validateBody, createPaymentSchema } from '@/lib/validation-schemas';

describe('validation-schemas > validateBody', () => {
  it('returns error for invalid JSON body', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: 'not-json',
    });
    const result = await validateBody(request, createPaymentSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
    }
  });

  it('returns validation error for invalid data', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0 }),
    });
    const result = await validateBody(request, createPaymentSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
    }
  });

  it('returns success for valid data', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 100,
        sourceAccountId: 'acc1',
        destAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    });
    const result = await validateBody(request, createPaymentSchema);
    expect(result.success).toBe(true);
  });

  it('returns error for empty body', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    const result = await validateBody(request, createPaymentSchema);
    expect(result.success).toBe(false);
  });

  it('returns error for missing required fields', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const result = await validateBody(request, createPaymentSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(400);
    }
  });
});
