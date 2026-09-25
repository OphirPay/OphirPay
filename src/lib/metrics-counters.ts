import { Counter, Gauge } from 'prom-client';

export const rpcFailoverCounter = new Counter({
  name: 'rpc_failover_total',
  help: 'Total number of RPC failovers',
});

export const rpcActiveEndpointGauge = new Gauge({
  name: 'rpc_active_endpoint_index',
  help: 'Index of the currently active RPC endpoint',
});
