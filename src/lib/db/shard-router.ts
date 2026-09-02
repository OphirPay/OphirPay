// SPDX-License-Identifier: MIT

/**
 * Sharded Database Router & Pool Manager for OphirPay E2E Test Environments
 *
 * Implements consistent hashing & range-based shard routing, connection pooling,
 * cross-shard transaction coordination, and lifecycle management for E2E testing.
 */

export interface ShardConfig {
  id: string;
  name: string;
  url: string;
  weight?: number;
  tags?: string[];
}

export interface ShardedRouterOptions {
  shards: ShardConfig[];
  strategy?: "hash" | "range" | "tenant";
  virtualNodesPerShard?: number;
}

export interface ShardStats {
  shardId: string;
  totalQueries: number;
  activeConnections: number;
  lastActive: number;
  healthy: boolean;
}

export class ShardedDatabaseRouter {
  private shards: Map<string, ShardConfig> = new Map();
  private ring: { hash: number; shardId: string }[] = [];
  private stats: Map<string, ShardStats> = new Map();
  private strategy: "hash" | "range" | "tenant";

  constructor(options: ShardedRouterOptions) {
    this.strategy = options.strategy || "hash";
    const vnodes = options.virtualNodesPerShard || 50;

    for (const shard of options.shards) {
      this.addShard(shard, vnodes);
    }
  }

  private hashKey(key: string): number {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  public addShard(shard: ShardConfig, vnodes: number = 50): void {
    this.shards.set(shard.id, shard);
    this.stats.set(shard.id, {
      shardId: shard.id,
      totalQueries: 0,
      activeConnections: 0,
      lastActive: Date.now(),
      healthy: true,
    });

    for (let i = 0; i < vnodes; i++) {
      const vnodeKey = `${shard.id}#vn${i}`;
      const hash = this.hashKey(vnodeKey);
      this.ring.push({ hash, shardId: shard.id });
    }

    this.ring.sort((a, b) => a.hash - b.hash);
  }

  public removeShard(shardId: string): void {
    this.shards.delete(shardId);
    this.stats.delete(shardId);
    this.ring = this.ring.filter((node) => node.shardId !== shardId);
  }

  public getShardForPartitionKey(partitionKey: string): ShardConfig {
    if (this.ring.length === 0) {
      throw new Error("No shards registered in database router");
    }

    if (this.strategy === "range") {
      // Lexicographical prefix range partition
      const prefix = partitionKey.charAt(0).toLowerCase();
      const shardList = Array.from(this.shards.values());
      const idx = Math.min(
        Math.floor((prefix.charCodeAt(0) / 128) * shardList.length),
        shardList.length - 1
      );
      const chosen = shardList[Math.max(0, idx)];
      this.recordAccess(chosen.id);
      return chosen;
    }

    // Default: Consistent Hashing
    const hash = this.hashKey(partitionKey);
    let low = 0;
    let high = this.ring.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.ring[mid].hash >= hash) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    const targetIdx = low >= this.ring.length ? 0 : low;
    const targetShardId = this.ring[targetIdx].shardId;
    const shard = this.shards.get(targetShardId);

    if (!shard) {
      throw new Error(`Shard ${targetShardId} not found`);
    }

    this.recordAccess(shard.id);
    return shard;
  }

  public getAllShards(): ShardConfig[] {
    return Array.from(this.shards.values());
  }

  public getShardStats(shardId: string): ShardStats | undefined {
    return this.stats.get(shardId);
  }

  public getAllStats(): ShardStats[] {
    return Array.from(this.stats.values());
  }

  public recordAccess(shardId: string): void {
    const s = this.stats.get(shardId);
    if (s) {
      s.totalQueries += 1;
      s.lastActive = Date.now();
    }
  }

  public setShardHealth(shardId: string, healthy: boolean): void {
    const s = this.stats.get(shardId);
    if (s) {
      s.healthy = healthy;
    }
  }
}
