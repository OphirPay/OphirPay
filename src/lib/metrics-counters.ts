// Copyright (c) 2024 OphirPay. All rights reserved.
import { Counter, Gauge, Histogram } from 'prom-client';

class MetricsCounter {
  private static instance: MetricsCounter;

  private rpcActiveEndpoint: Gauge<string>;
  private rpcFailoverCount: Counter;
  private rpcFailoverReason: Histogram<string>;

  private constructor() {
    this.rpcActiveEndpoint = new Gauge({
      name: 'rpc_active_endpoint',
      help: 'Currently active RPC endpoint',
      labelNames: ['endpoint'],
    });

    this.rpcFailoverCount = new Counter({
      name: 'rpc_failover_count',
      help: 'Total number of RPC failovers',
    });

    this.rpcFailoverReason = new Histogram({
      name: 'rpc_failover_reason',
      help: 'Duration of RPC failover attempts by reason',
      labelNames: ['reason', 'endpoint'],
      buckets: [0.1, 0.5, 1, 2.5, 5, 10],
    });
  }

  public static getInstance(): MetricsCounter {
    if (!MetricsCounter.instance) {
      MetricsCounter.instance = new MetricsCounter();
    }
    return MetricsCounter.instance;
  }

  public set(endpoint: string, value: string): void {
    this.rpcActiveEndpoint.set({ endpoint }, value === '1' ? 1 : 0);
  }

  public increment(name: string): void {
    if (name === 'rpc_failover_transitions') {
      this.rpcFailoverCount.inc();
    }
  }

  public record(reason: string, labels: { endpoint: string }): void {
    this.rpcFailoverReason.observe({
      reason: reason.substring(0, 50),
      endpoint: labels.endpoint,
    }, 1);
  }
}

export { MetricsCounter };
