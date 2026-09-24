// Copyright (c) 2024 OphirPay. All rights reserved.
import { RPCFailover } from '@/lib/rpc-failover';
import { createLogger } from '@/lib/logger';

jest.mock('@/lib/logger');

describe('RPCFailover', () => {
  const mockLogger = createLogger('RPCFailover') as jest.Mocked<typeof createLogger>;
  const mockLoggerWarn = jest.spyOn(mockLogger, 'warn');

  const config = {
    endpoints: ['primary', 'fallback1', 'fallback2'],
    primaryEndpoint: 'primary',
  };

  let failover: RPCFailover;

  beforeEach(() => {
    failover = new RPCFailover(config);
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should start with primary endpoint', () => {
      expect(failover.getFailoverState()).toEqual({
        activeEndpoint: 'primary',
        failoverCount: 0,
      });
    });
  });

  describe('request handling', () => {
    it('should succeed on primary endpoint', async () => {
      const result = await failover.attemptRequest('primary', () => Promise.resolve('success'));
      expect(result).toBe('success');
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should failover on primary failure', async () => {
      const requestFn = jest.fn().mockRejectedValue(new Error('Primary failed'));
      const result = await failover.attemptRequest('primary', requestFn);
      expect(result).toBe('fallback_success');
      expect(mockLoggerWarn).toHaveBeenCalledWith('Request failed on primary: Primary failed');
      expect(failover.getFailoverState()).toEqual({
        activeEndpoint: 'fallback1',
        failoverCount: 1,
        lastFailure: {
          endpoint: 'primary',
          reason: 'Primary failed',
          timestamp: expect.any(Date),
        },
      });
    });

    it('should exhaust all endpoints on total failure', async () => {
      const requestFn = jest.fn().mockRejectedValue(new Error('All failed'));
      await expect(failover.attemptRequest('primary', requestFn)).rejects.toThrow('All RPC endpoints failed');
      expect(mockLoggerWarn).toHaveBeenCalledTimes(3); // primary + 2 fallbacks
    });
  });

  describe('endpoint transitions', () => {
    it('should log transitions', async () => {
      const requestFn = jest.fn().mockRejectedValueOnce(new Error('Primary failed'))
        .mockResolvedValueOnce('fallback_success');
      await failover.attemptRequest('primary', requestFn);
      expect(mockLoggerWarn).toHaveBeenCalledWith('Transitioning from primary to fallback1');
    });
  });
});
