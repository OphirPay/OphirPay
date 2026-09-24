// Copyright (c) 2024 OphirPay. All rights reserved.
import { NextResponse } from 'next/server';
import { GET } from '@/app/api/health/route';
import { RPCFailover } from '@/lib/rpc-failover';
import { getFailoverInstance } from '@/lib/rpc-failover-context';

jest.mock('@/lib/rpc-failover-context');

describe('Health API', () => {
  beforeEach(() => {
    const mockFailover = {
      getFailoverState: jest.fn().mockReturnValue({
        activeEndpoint: 'primary',
        failoverCount: 0,
      }),
    } as unknown as RPCFailover);
    (getFailoverInstance as jest.Mock).mockReturnValue(mockFailover);
  });

  it('should return healthy status with primary endpoint', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toEqual({
      status: 'healthy',
      rpc: {
        activeEndpoint: 'primary',
        failoverCount: 0,
      },
      timestamp: expect.any(String),
    });
  });

  it('should return degraded status with failover', async () => {
    const mockFailover = {
      getFailoverState: jest.fn().mockReturnValue({
        activeEndpoint: 'fallback1',
        failoverCount: 1,
        lastFailure: {
          endpoint: 'primary',
          reason: 'Connection timeout',
          timestamp: new Date('2024-01-01'),
        },
      }),
    } as unknown as RPCFailover);
    (getFailoverInstance as jest.Mock).mockReturnValue(mockFailover);

    const response = await GET();
    const data = await response.json();
    expect(data).toEqual({
      status: 'degraded',
      rpc: {
        activeEndpoint: 'fallback1',
        failoverCount: 1,
        lastFailure: {
          endpoint: 'primary',
          reason: 'Connection timeout',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      },
      timestamp: expect.any(String),
    });
  });
});
