// Copyright (c) 2024 OphirPay. All rights reserved.
import { EventEmitter } from 'events';
import { createLogger } from '@/lib/logger';
import { MetricsCounter } from '@/lib/metrics-counters';

interface FailoverState {
  activeEndpoint: string;
  failoverCount: number;
  lastFailure?: {
    endpoint: string;
    reason: string;
    timestamp: Date;
  };
}

interface FailoverConfig {
  endpoints: string[];
  primaryEndpoint: string;
  maxRetries?: number;
}

class RPCFailover {
  private state: FailoverState;
  private logger = createLogger('RPCFailover');
  private metrics = new MetricsCounter();
  private events = new EventEmitter();

  constructor(config: FailoverConfig) {
    this.state = {
      activeEndpoint: config.primaryEndpoint,
      failoverCount: 0,
    };
    this.metrics.increment('rpc_failover_initialized');
  }

  public async attemptRequest(
    endpoint: string,
    requestFn: () => Promise<any>
  ): Promise<any> {
    try {
      return await requestFn();
    } catch (error) {
      this.logger.warn(`Request failed on ${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
      this.recordFailure(endpoint, error instanceof Error ? error.message : 'Unknown error');
      return this.attemptFailover(requestFn);
    }
  }

  private async attemptFailover(requestFn: () => Promise<any>): Promise<any> {
    const candidates = this.getFailoverCandidates();
    for (const endpoint of candidates) {
      try {
        const result = await requestFn();
        this.transitionEndpoint(endpoint);
        return result;
      } catch (error) {
        this.logger.warn(`Failover attempt on ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }
    throw new Error('All RPC endpoints failed');
  }

  private getFailoverCandidates(): string[] {
    return this.state.endpoints.filter(e => e !== this.state.activeEndpoint);
  }

  private transitionEndpoint(newEndpoint: string): void {
    if (this.state.activeEndpoint === newEndpoint) return;

    this.logger.warn(`Transitioning from ${this.state.activeEndpoint} to ${newEndpoint}`);
    this.metrics.increment('rpc_failover_transitions');
    this.metrics.set('rpc_active_endpoint', newEndpoint);

    this.state = {
      ...this.state,
      activeEndpoint: newEndpoint,
      failoverCount: this.state.failoverCount + 1,
    };

    this.events.emit('endpoint-transition', this.state);
  }

  private recordFailure(endpoint: string, reason: string): void {
    this.state = {
      ...this.state,
      lastFailure: {
        endpoint,
        reason,
        timestamp: new Date(),
      },
    };
    this.metrics.record('rpc_failover_reason', { reason, endpoint });
  }

  public getFailoverState(): FailoverState {
    return { ...this.state };
  }

  public on(event: 'endpoint-transition', listener: (state: FailoverState) => void): void {
    this.events.on(event, listener);
  }
}

export { RPCFailover, type FailoverState };
