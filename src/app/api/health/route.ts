// Copyright (c) 2024 OphirPay. All rights reserved.
import { NextResponse } from 'next/server';
import { RPCFailover } from '@/lib/rpc-failover';
import { getFailoverInstance } from '@/lib/rpc-failover-context';

interface HealthResponse {
  status: 'healthy' | 'degraded';
  rpc: {
    activeEndpoint: string;
    failoverCount: number;
    lastFailure?: {
      endpoint: string;
      reason: string;
      timestamp: string;
    };
  };
  timestamp: string;
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const failover = getFailoverInstance();
  const state = failover.getFailoverState();

  const response: HealthResponse = {
    status: state.failoverCount > 0 ? 'degraded' : 'healthy',
    rpc: {
      activeEndpoint: state.activeEndpoint,
      failoverCount: state.failoverCount,
      ...(state.lastFailure && {
        lastFailure: {
          ...state.lastFailure,
          timestamp: state.lastFailure.timestamp.toISOString(),
        },
      }),
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
