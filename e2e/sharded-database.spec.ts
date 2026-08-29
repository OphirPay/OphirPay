// SPDX-License-Identifier: MIT

import { test, expect } from "@playwright/test";
import {
  ShardedDatabaseRouter,
  ShardConfig,
} from "../src/lib/db/shard-router";
import {
  ShardedTestFixtureManager,
  ShardedPaymentRecord,
} from "../src/lib/db/sharded-test-fixture";

test.describe("E2E: Sharded Database Infrastructure & Lifecycle", () => {
  const testShards: ShardConfig[] = [
    {
      id: "shard-us-east",
      name: "US East Primary Shard",
      url: "postgresql://postgres:pass@localhost:5432/ophirpay_shard_east",
      weight: 100,
    },
    {
      id: "shard-eu-west",
      name: "EU West Secondary Shard",
      url: "postgresql://postgres:pass@localhost:5433/ophirpay_shard_west",
      weight: 100,
    },
    {
      id: "shard-ap-south",
      name: "APAC Tertiary Shard",
      url: "postgresql://postgres:pass@localhost:5434/ophirpay_shard_south",
      weight: 100,
    },
  ];

  let fixtureManager: ShardedTestFixtureManager;
  let router: ShardedDatabaseRouter;

  test.beforeEach(() => {
    fixtureManager = new ShardedTestFixtureManager(testShards);
    router = fixtureManager.getRouter();
  });

  test.afterEach(async () => {
    await fixtureManager.cleanup();
  });

  test("Router initializes all configured shards with active health status", async () => {
    const shards = router.getAllShards();
    expect(shards.length).toBe(3);
    expect(shards.map((s) => s.id)).toEqual([
      "shard-us-east",
      "shard-eu-west",
      "shard-ap-south",
    ]);

    const stats = router.getAllStats();
    expect(stats.length).toBe(3);
    for (const stat of stats) {
      expect(stat.healthy).toBe(true);
      expect(stat.totalQueries).toBe(0);
    }
  });

  test("Consistent hashing routes partition keys deterministically across shards", async () => {
    const address1 = "GBVOLP64B74XU3PF7Y2Y6O7NUXQZEXRQLJ56P52G7XN3W2Z7664QZ4L4";
    const address2 = "GCH2ZPVXZN52QG6S4G6OQZ6M6RQLJ56P52G7XN3W2Z7664QZ4L4GBVOL";
    const address3 = "GDQ7XN3W2Z7664QZ4L4GBVOLP64B74XU3PF7Y2Y6O7NUXQZEXRQLJ56P";

    const shardA1 = router.getShardForPartitionKey(address1);
    const shardA2 = router.getShardForPartitionKey(address1);
    expect(shardA1.id).toBe(shardA2.id);

    const shardB = router.getShardForPartitionKey(address2);
    const shardC = router.getShardForPartitionKey(address3);

    expect(shardA1.id).toBeDefined();
    expect(shardB.id).toBeDefined();
    expect(shardC.id).toBeDefined();
  });

  test("Seeds and queries payment records with shard data isolation", async () => {
    const sender = "GBAUTO77XU3PF7Y2Y6O7NUXQZEXRQLJ56P52G7XN3W2Z7664QZ4L4OPI";
    const recipient = "GDRECV88B74XU3PF7Y2Y6O7NUXQZEXRQLJ56P52G7XN3W2Z7664QZ4L4";

    const seeded = await fixtureManager.seedPayment({
      id: "pay_test_001",
      senderAddress: sender,
      recipientAddress: recipient,
      amount: "250.50",
      asset: "XLM",
      status: "completed",
    });

    expect(seeded.id).toBe("pay_test_001");
    expect(seeded.shardId).toBeDefined();

    const retrieved = await fixtureManager.getPayment(sender, "pay_test_001");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("pay_test_001");
    expect(retrieved?.amount).toBe("250.50");
    expect(retrieved?.shardId).toBe(seeded.shardId);
  });

  test("Executes 2-phase cross-shard batch transactions atomically", async () => {
    const mockPayments = [
      {
        id: "batch_p1",
        senderAddress: "GA111111111111111111111111111111111111111111111111111111",
        recipientAddress: "GB222222222222222222222222222222222222222222222222222222",
        amount: "100.00",
        asset: "USDC",
        status: "completed" as const,
      },
      {
        id: "batch_p2",
        senderAddress: "GC333333333333333333333333333333333333333333333333333333",
        recipientAddress: "GD444444444444444444444444444444444444444444444444444444",
        amount: "200.00",
        asset: "XLM",
        status: "completed" as const,
      },
      {
        id: "batch_p3",
        senderAddress: "GE555555555555555555555555555555555555555555555555555555",
        recipientAddress: "GF666666666666666666666666666666666666666666666666666666",
        amount: "300.00",
        asset: "OPHIR",
        status: "completed" as const,
      },
    ];

    const result = await fixtureManager.executeCrossShardBatch(
      "batch_e2e_001",
      mockPayments
    );

    expect(result.status).toBe("committed");
    expect(result.payments.length).toBe(3);
    expect(result.involvedShards.length).toBeGreaterThan(0);

    const crossResults = await fixtureManager.queryCrossShard(
      (rec) => rec.status === "completed"
    );
    expect(crossResults.length).toBe(3);
  });

  test("Verifies even data distribution across shards under high load", async () => {
    // Generate 60 test transactions with distinct partition keys
    for (let i = 0; i < 60; i++) {
      const sender = `GACCT${i.toString().padStart(4, "0")}XU3PF7Y2Y6O7NUXQZEXRQLJ56P52G7XN3W2Z7664`;
      await fixtureManager.seedPayment({
        id: `load_pay_${i}`,
        senderAddress: sender,
        recipientAddress: "GDRECV_POOL",
        amount: (i * 10).toString(),
        asset: "USDC",
        status: "completed",
      });
    }

    const distribution = await fixtureManager.verifyDataDistribution();
    const totalCount = Object.values(distribution).reduce((a, b) => a + b, 0);
    expect(totalCount).toBe(60);

    // Ensure every shard received test payments (no starvation)
    for (const shard of testShards) {
      expect(distribution[shard.id]).toBeGreaterThan(0);
    }
  });

  test("Performs clean test teardown without shard state leakage", async () => {
    await fixtureManager.seedPayment({
      id: "ephemeral_pay_1",
      senderAddress: "GSENDER_EPH_1",
      recipientAddress: "GRECV_EPH_1",
      amount: "50.00",
      asset: "XLM",
      status: "completed",
    });

    await fixtureManager.cleanup();

    const distribution = await fixtureManager.verifyDataDistribution();
    for (const shard of testShards) {
      expect(distribution[shard.id]).toBe(0);
    }
  });
});
