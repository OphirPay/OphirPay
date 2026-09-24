// Copyright (c) 2024 OphirPay. All rights reserved.
import { RPCFailover } from './rpc-failover';

let failoverInstance: RPCFailover;

export function initializeFailover(config: Parameters<typeof RPCFailover>[0]): void {
  failoverInstance = new RPCFailover(config);
}

export function getFailoverInstance(): RPCFailover {
  if (!failoverInstance) {
    throw new Error('RPCFailover not initialized. Call initializeFailover first.');
  }
  return failoverInstance;
}
