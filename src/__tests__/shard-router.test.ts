// SPDX-License-Identifier: MIT
//
// Issue #711 — Unit tests for the ShardedDatabaseRouter.
//
// These tests focus on the router's logic independently of the E2E in-memory
// database fixture (sharded-test-fixture.ts).

import { describe, it, expect, beforeEach } from "vitest";
import { ShardedDatabaseRouter, ShardConfig } from "@/lib/db/shard-router";

describe("ShardedDatabaseRouter", () => {
  let shards: ShardConfig[];

  beforeEach(() => {
    shards = [
      { id: "s1", name: "Shard 1", url: "db://s1" },
      { id: "s2", name: "Shard 2", url: "db://s2" },
      { id: "s3", name: "Shard 3", url: "db://s3" },
    ];
  });

  describe("Initialization & Shard Management", () => {
    it("initializes with provided shards and correct defaults", () => {
      const router = new ShardedDatabaseRouter({ shards });
      expect(router.getAllShards()).toHaveLength(3);
      
      const stats = router.getAllStats();
      expect(stats).toHaveLength(3);
      expect(stats[0].healthy).toBe(true);
      expect(stats[0].totalQueries).toBe(0);
    });

    it("can add new shards at runtime", () => {
      const router = new ShardedDatabaseRouter({ shards: [] });
      router.addShard(shards[0]);
      expect(router.getAllShards()).toHaveLength(1);
    });

    it("can remove shards", () => {
      const router = new ShardedDatabaseRouter({ shards });
      router.removeShard("s2");
      const remaining = router.getAllShards();
      expect(remaining).toHaveLength(2);
      expect(remaining.map(s => s.id)).not.toContain("s2");
    });
    
    it("updates shard health", () => {
      const router = new ShardedDatabaseRouter({ shards });
      router.setShardHealth("s1", false);
      const stat = router.getShardStats("s1");
      expect(stat?.healthy).toBe(false);
    });
  });

  describe("Consistent Hashing Routing (Default Strategy)", () => {
    it("throws if no shards exist", () => {
      const router = new ShardedDatabaseRouter({ shards: [] });
      expect(() => router.getShardForPartitionKey("user_123")).toThrow(/No shards registered/);
    });

    it("routes the same key to the same shard deterministically", () => {
      const router = new ShardedDatabaseRouter({ shards });
      const key = "user_456_deterministic";
      
      const firstRoute = router.getShardForPartitionKey(key);
      for (let i = 0; i < 10; i++) {
        expect(router.getShardForPartitionKey(key).id).toBe(firstRoute.id);
      }
    });

    it("distributes keys across multiple shards", () => {
      const router = new ShardedDatabaseRouter({ shards });
      const hitCounts: Record<string, number> = { s1: 0, s2: 0, s3: 0 };
      
      for (let i = 0; i < 100; i++) {
        const shard = router.getShardForPartitionKey(`user_${i}`);
        hitCounts[shard.id]++;
      }
      
      // With 50 vnodes each, we expect *some* distribution (not all to one shard)
      expect(hitCounts.s1).toBeGreaterThan(0);
      expect(hitCounts.s2).toBeGreaterThan(0);
      expect(hitCounts.s3).toBeGreaterThan(0);
    });

    it("records access stats when routing", () => {
      const router = new ShardedDatabaseRouter({ shards });
      const key = "stat_test_key";
      const shard = router.getShardForPartitionKey(key);
      
      const stat = router.getShardStats(shard.id);
      expect(stat?.totalQueries).toBe(1);
      
      router.getShardForPartitionKey(key);
      expect(router.getShardStats(shard.id)?.totalQueries).toBe(2);
    });
  });

  describe("Range-based Routing Strategy", () => {
    it("routes lexicographically based on prefix", () => {
      const router = new ShardedDatabaseRouter({ shards, strategy: "range" });
      
      // 'a' has charCode 97, 'z' is 122
      // shards.length = 3
      // Expected logic: floor((char / 128) * 3)
      
      // 'a' (97) / 128 * 3 = 0.75 * 3 = 2.25 -> 2 -> s3
      const shardA = router.getShardForPartitionKey("alpha");
      expect(shardA.id).toBe("s3");
      
      // 'z' (122) / 128 * 3 = 0.95 * 3 = 2.85 -> 2 -> s3
      const shardZ = router.getShardForPartitionKey("zebra");
      expect(shardZ.id).toBe("s3");
      
      // '0' (48) / 128 * 3 = 0.375 * 3 = 1.125 -> 1 -> s2
      const shard0 = router.getShardForPartitionKey("0123");
      expect(shard0.id).toBe("s2");

      // '\x01' (1) / 128 * 3 = 0.007 * 3 = 0.023 -> 0 -> s1
      const shardLow = router.getShardForPartitionKey("\x01low");
      expect(shardLow.id).toBe("s1");
    });
  });
});
