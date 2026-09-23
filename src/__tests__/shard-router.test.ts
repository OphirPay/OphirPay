// SPDX-License-Identifier: MIT
// Unit tests for ShardedDatabaseRouter — consistent-hash and range routing,
// shard lifecycle, and access statistics.
//
// These live in the unit suite because `src/lib/db/**` is no longer excluded
// from coverage: sharded routing is pure in-memory logic and does not need a
// live Playwright environment to be exercised.

import { describe, it, expect } from "vitest";
import { ShardedDatabaseRouter } from "@/lib/db/shard-router";
import type { ShardConfig } from "@/lib/db/shard-router";

function makeShards(): ShardConfig[] {
  return [
    { id: "shard-a", name: "Shard A", url: "postgresql://a", weight: 100 },
    { id: "shard-b", name: "Shard B", url: "postgresql://b", weight: 100 },
    { id: "shard-c", name: "Shard C", url: "postgresql://c", weight: 100 },
  ];
}

const ACCOUNTS = [
  "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
  "GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCD",
  "alice",
  "bob",
  "carol",
  "dave",
  "erin",
  "frank",
];

describe("ShardedDatabaseRouter", () => {
  it("registers every shard supplied to the constructor", () => {
    const router = new ShardedDatabaseRouter({ shards: makeShards() });

    expect(router.getAllShards().map((s) => s.id)).toEqual([
      "shard-a",
      "shard-b",
      "shard-c",
    ]);
  });

  it("exposes one stats entry per registered shard", () => {
    const router = new ShardedDatabaseRouter({ shards: makeShards() });
    const stats = router.getAllStats();

    expect(stats).toHaveLength(3);
    for (const stat of stats) {
      expect(stat.totalQueries).toBe(0);
      expect(stat.activeConnections).toBe(0);
      expect(stat.healthy).toBe(true);
      expect(typeof stat.lastActive).toBe("number");
    }
  });

  it("routes the same partition key to the same shard every time", () => {
    const router = new ShardedDatabaseRouter({ shards: makeShards() });

    for (const key of ACCOUNTS) {
      const first = router.getShardForPartitionKey(key).id;
      const second = router.getShardForPartitionKey(key).id;
      expect(second).toBe(first);
    }
  });

  it("spreads partition keys across more than one shard", () => {
    const router = new ShardedDatabaseRouter({ shards: makeShards() });
    const hit = new Set(ACCOUNTS.map((k) => router.getShardForPartitionKey(k).id));

    expect(hit.size).toBeGreaterThan(1);
  });

  it("increments the access counter for the shard it routes to", () => {
    const router = new ShardedDatabaseRouter({ shards: makeShards() });
    const shard = router.getShardForPartitionKey(ACCOUNTS[0]);

    const stats = router.getShardStats(shard.id);
    expect(stats?.totalQueries).toBe(1);

    router.getShardForPartitionKey(ACCOUNTS[0]);
    expect(router.getShardStats(shard.id)?.totalQueries).toBe(2);
  });

  it("throws when routing with no shards registered", () => {
    const router = new ShardedDatabaseRouter({ shards: [] });

    expect(() => router.getShardForPartitionKey("anything")).toThrow(
      /No shards registered/
    );
  });

  describe("range strategy", () => {
    it("maps partition-key prefixes to deterministic shards", () => {
      const router = new ShardedDatabaseRouter({
        shards: makeShards(),
        strategy: "range",
      });

      // Prefix buckets are derived from the first character's code point.
      expect(router.getShardForPartitionKey("!").id).toBe("shard-a");
      expect(router.getShardForPartitionKey("0").id).toBe("shard-b");
      expect(router.getShardForPartitionKey("a").id).toBe("shard-c");
    });

    it("is case-insensitive on the partition-key prefix", () => {
      const router = new ShardedDatabaseRouter({
        shards: makeShards(),
        strategy: "range",
      });

      expect(router.getShardForPartitionKey("Alice").id).toBe(
        router.getShardForPartitionKey("alice").id
      );
    });

    it("records access against the range-selected shard", () => {
      const router = new ShardedDatabaseRouter({
        shards: makeShards(),
        strategy: "range",
      });

      const shard = router.getShardForPartitionKey("bob");
      expect(router.getShardStats(shard.id)?.totalQueries).toBe(1);
    });
  });

  describe("shard lifecycle", () => {
    it("adds a shard after construction and keeps its stats", () => {
      const router = new ShardedDatabaseRouter({ shards: makeShards() });

      router.addShard({
        id: "shard-d",
        name: "Shard D",
        url: "postgresql://d",
        weight: 50,
      });

      expect(router.getAllShards()).toHaveLength(4);
      expect(router.getShardStats("shard-d")?.healthy).toBe(true);
    });

    it("stops routing to a shard once it is removed", () => {
      const router = new ShardedDatabaseRouter({ shards: makeShards() });
      router.removeShard("shard-a");

      expect(router.getAllShards().map((s) => s.id)).toEqual([
        "shard-b",
        "shard-c",
      ]);
      expect(router.getShardStats("shard-a")).toBeUndefined();

      const hit = new Set(ACCOUNTS.map((k) => router.getShardForPartitionKey(k).id));
      expect(hit.has("shard-a")).toBe(false);
    });

    it("throws when every shard has been removed", () => {
      const router = new ShardedDatabaseRouter({ shards: makeShards() });
      for (const shard of makeShards()) {
        router.removeShard(shard.id);
      }

      expect(() => router.getShardForPartitionKey("alice")).toThrow(
        /No shards registered/
      );
    });
  });

  describe("health and statistics", () => {
    it("flips the health flag for a known shard", () => {
      const router = new ShardedDatabaseRouter({ shards: makeShards() });

      router.setShardHealth("shard-b", false);
      expect(router.getShardStats("shard-b")?.healthy).toBe(false);

      router.setShardHealth("shard-b", true);
      expect(router.getShardStats("shard-b")?.healthy).toBe(true);
    });

    it("ignores statistics updates for unknown shards", () => {
      const router = new ShardedDatabaseRouter({ shards: makeShards() });

      expect(() => router.recordAccess("shard-zzz")).not.toThrow();
      expect(() => router.setShardHealth("shard-zzz", false)).not.toThrow();
      expect(router.getShardStats("shard-zzz")).toBeUndefined();
    });
  });
});
