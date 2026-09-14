import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '@/lib/logger';

describe('logger redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts memo text', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('payment sent', { memo: 'Payment for invoice #123' });
    const output = spy.mock.calls[0][0];
    expect(output).not.toContain('Payment for invoice #123');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts email addresses', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('user action', { user: 'test@example.com' });
    const output = spy.mock.calls[0][0];
    expect(output).not.toContain('test@example.com');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts API keys', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('api call', { apiKey: 'sk_live_abc123xyz789' });
    const output = spy.mock.calls[0][0];
    expect(output).not.toContain('sk_live_abc123xyz789');
    expect(output).toContain('[REDACTED]');
  });

  it('does not redact safe fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('request', { method: 'GET', path: '/api/payments' });
    const output = spy.mock.calls[0][0];
    expect(output).toContain('GET');
    expect(output).toContain('/api/payments');
  });
});
