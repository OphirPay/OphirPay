// SPDX-License-Identifier: MIT

/**
 * Sharded Test Fixture & Lifecycle Isolation Manager
 *
 * Provides isolated sharded test tenants, automated shard schema synchronization,
 * cross-shard data assertion utilities, and atomic teardown for Playwright/Jest E2E suites.
 */

import { ShardedDatabaseRouter, ShardConfig } from "./shard-router";

export interface ShardedPaymentRecord {
  id: string;
  senderAddress: string;
  recipientAddress: string;
  amount: string;
  asset: string;
  status: "pending" | "completed" | "failed";
  shardId: string;
  createdAt: number;
}

export interface CrossShardTransactionBatch {
  batchId: string;
  payments: ShardedPaymentRecord[];
  involvedShards: string[];
  status: "pending" | "committed" | "aborted";
}

export class ShardedTestFixtureManager {
  private router: ShardedDatabaseRouter;
  private shardStores: Map<string, Map<string, ShardedPaymentRecord>> = new Map();

  constructor(shards: ShardConfig[]) {
    this.router = new ShardedDatabaseRouter({ shards, strategy: "hash" });
    for (const shard of shards) {
      this.shardStores.set(shard.id, new Map());
    }
  }

  public getRouter(): ShardedDatabaseRouter {
    return this.router;
  }

  public async seedPayment(
    payment: Omit<ShardedPaymentRecord, "shardId" | "createdAt">
  ): Promise<ShardedPaymentRecord> {
    const targetShard = this.router.getShardForPartitionKey(
      payment.senderAddress
    );
    const store = this.shardStores.get(targetShard.id);

    if (!store) {
      throw new Error(`Store for shard ${targetShard.id} not initialized`);
    }

    const record: ShardedPaymentRecord = {
      ...payment,
      shardId: targetShard.id,
      createdAt: Date.now(),
    };

    store.set(`payment:${payment.id}`, record);
    return record;
  }

  public async getPayment(
    senderAddress: string,
    paymentId: string
  ): Promise<ShardedPaymentRecord | null> {
    const targetShard = this.router.getShardForPartitionKey(senderAddress);
    const store = this.shardStores.get(targetShard.id);
    return store?.get(`payment:${paymentId}`) || null;
  }

  public async executeCrossShardBatch(
    batchId: string,
    payments: Omit<ShardedPaymentRecord, "shardId" | "createdAt">[]
  ): Promise<CrossShardTransactionBatch> {
    const involvedShards = new Set<string>();
    const createdRecords: ShardedPaymentRecord[] = [];

    // Phase 1: Prepare & route
    for (const p of payments) {
      const shard = this.router.getShardForPartitionKey(p.senderAddress);
      involvedShards.add(shard.id);
      createdRecords.push({
        ...p,
        shardId: shard.id,
        createdAt: Date.now(),
      });
    }

    // Phase 2: Commit across participating shards
    for (const rec of createdRecords) {
      const store = this.shardStores.get(rec.shardId);
      store?.set(`payment:${rec.id}`, rec);
      store?.set(`batch:${batchId}:${rec.id}`, rec);
    }

    return {
      batchId,
      payments: createdRecords,
      involvedShards: Array.from(involvedShards),
      status: "committed",
    };
  }

  public async queryCrossShard(
    filter: (record: ShardedPaymentRecord) => boolean
  ): Promise<ShardedPaymentRecord[]> {
    const results: ShardedPaymentRecord[] = [];

    for (const [shardId, store] of this.shardStores.entries()) {
      this.router.recordAccess(shardId);
      for (const [key, val] of store.entries()) {
        if (key.startsWith("payment:") && filter(val)) {
          results.push(val);
        }
      }
    }

    return results;
  }

  public async verifyDataDistribution(): Promise<Record<string, number>> {
    const distribution: Record<string, number> = {};
    for (const [shardId, store] of this.shardStores.entries()) {
      let paymentCount = 0;
      for (const key of store.keys()) {
        if (key.startsWith("payment:")) paymentCount++;
      }
      distribution[shardId] = paymentCount;
    }
    return distribution;
  }

  public async cleanup(): Promise<void> {
    for (const store of this.shardStores.values()) {
      store.clear();
    }
  }
}
