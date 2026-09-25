import { Logger } from '@oasisprotocol/soroban-client';
import { Counter, Gauge } from 'prom-client';
import { rpcMetrics } from './metrics-counters';

const logger = console as unknown as Logger; // replace with actual logger if available

export interface RpcEndpoint {
  name: string;
  url: string;
}

export interface RpcFailoverState {
  activeEndpoint: RpcEndpoint;
  failoverCount: number;
  lastFailureReason: Record<string, string | null>;
}

const endpoints: RpcEndpoint[] = [
  { name: 'primary', url: process.env.SOROBAN_RPC_PRIMARY ?? '' },
  { name: 'secondary', url: process.env.SOROBAN_RPC_SECONDARY ?? '' },
  { name: 'thirdParty', url: process.env.SOROBAN_RPC_THIRD ?? '' },
];

let currentIndex = 0;
let failoverCount = 0;
const lastFailureReason: Record<string, string | null> = {};

endpoints.forEach((e) => {
  lastFailureReason[e.name] = null;
});

export const getRpcFailoverState = (): RpcFailoverState => ({
  activeEndpoint: endpoints[currentIndex],
  failoverCount,
  lastFailureReason,
});

/**
 * Attempts to use the current endpoint. If it fails, rotates to the next one.
 * @param fn async function that performs a request using the current endpoint
 * @returns result of fn
 */
export const withFailover = async <T>(fn: (endpoint: RpcEndpoint) => Promise<T>): Promise<T> => {
  const attempt = async (idx: number): Promise<T> => {
    const endpoint = endpoints[idx];
    try {
      const result = await fn(endpoint);
      // success: reset failure reason
      lastFailureReason[endpoint.name] = null;
      return result;
    } catch (err: any) {
      // record failure
      lastFailureReason[endpoint.name] = err.message ?? String(err);
      // rotate
      const prev = endpoint;
      const nextIdx = (idx + 1) % endpoints.length;
      const next = endpoints[nextIdx];
      if (nextIdx !== idx) {
        failoverCount += 1;
        logger.warn(
          `RPC failover: ${prev.name} (${prev.url}) -> ${next.name} (${next.url}) due to ${err.message}`
        );
        // update metrics
        rpcMetrics.failoverCounter.inc();
        rpcMetrics.activeEndpointGauge.set(nextIdx);
      }
      // retry with next
      return attempt(nextIdx);
    }
  };
  return attempt(currentIndex);
};

export const rpcMetrics = {
  failoverCounter: new Counter({
    name: 'rpc_failover_total',
    help: 'Total number of RPC failovers',
  }),
  activeEndpointGauge: new Gauge({
    name: 'rpc_active_endpoint_index',
    help: 'Index of the currently active RPC endpoint',
  }),
};
