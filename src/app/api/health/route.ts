import type { NextApiRequest, NextApiResponse } from 'next';
import { getRpcFailoverState } from '../../../lib/rpc-failover';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const state = getRpcFailoverState();

  // existing health checks
  const health = {
    status: 'ok',
    rpc: {
      activeEndpoint: state.activeEndpoint.name,
      failoverCount: state.failoverCount,
      lastFailureReason: state.lastFailureReason,
    },
    // ... other health fields
  };

  res.status(200).json(health);
}
