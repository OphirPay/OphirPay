// SPDX-License-Identifier: MIT

/**
 * Issue #763 — Boundary enforcement: test helpers must not live in src/lib.
 *
 * Test utilities (`test-factory.ts` and `sharded-test-fixture.ts`) belong in
 * `tests/support/` so production trees are not burdened with test scaffolding,
 * test helpers are not accidentally imported by application code, and coverage
 * exclusion lists do not mask architectural boundary violations.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  createTestPayment,
  createTestBatch,
  createTestRecipient,
  createTestPayments,
  ShardedTestFixtureManager,
} from "@tests/support";

const ROOT = process.cwd();

describe("test-only helpers architectural boundary (Issue #763)", () => {
  it("ensures no test-only helper modules remain in src/lib", () => {
    expect(existsSync(path.join(ROOT, "src/lib/test-factory.ts"))).toBe(false);
    expect(existsSync(path.join(ROOT, "src/lib/db/sharded-test-fixture.ts"))).toBe(false);
  });

  it("ensures test helpers exist under tests/support/", () => {
    expect(existsSync(path.join(ROOT, "tests/support/test-factory.ts"))).toBe(true);
    expect(existsSync(path.join(ROOT, "tests/support/sharded-test-fixture.ts"))).toBe(true);
    expect(existsSync(path.join(ROOT, "tests/support/index.ts"))).toBe(true);
  });

  it("removes test-only helpers from vitest.config.ts coverage exclusions", () => {
    const vitestConfig = readFileSync(path.join(ROOT, "vitest.config.ts"), "utf-8");
    expect(vitestConfig).not.toContain("src/lib/test-factory.ts");
    expect(vitestConfig).not.toContain("src/lib/db/sharded-test-fixture.ts");
  });

  it("verifies tests/support/test-factory functions properly", () => {
    const payment = createTestPayment({ amount: 500, assetCode: "USDC" });
    expect(payment.id).toMatch(/^test_\d+_\d+$/);
    expect(payment.amount).toBe(500);
    expect(payment.assetCode).toBe("USDC");
    expect(payment.status).toBe("COMPLETED");

    const batch = createTestBatch({ name: "Custom Batch" });
    expect(batch.name).toBe("Custom Batch");
    expect(batch.userId).toBe("test-user");

    const recipient = createTestRecipient({ amount: 25 });
    expect(recipient.amount).toBe(25);
    expect(recipient.address).toBe("GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCD");

    const payments = createTestPayments(3);
    expect(payments).toHaveLength(3);
    expect(payments[0].id).toBe("pay_0");
    expect(payments[0].amount).toBe(100);
    expect(payments[2].id).toBe("pay_2");
    expect(payments[2].amount).toBe(300);
  });

  it("verifies tests/support/sharded-test-fixture functions properly", async () => {
    const shards = [
      { id: "shard-1", name: "Shard 1", url: "db://shard1" },
      { id: "shard-2", name: "Shard 2", url: "db://shard2" },
    ];
    const fixture = new ShardedTestFixtureManager(shards);
    expect(fixture.getRouter()).toBeDefined();

    const seeded = await fixture.seedPayment({
      id: "p1",
      senderAddress: "G_SENDER_ADDR_1",
      recipientAddress: "G_RECIPIENT_ADDR_1",
      amount: "100.5",
      asset: "XLM",
      status: "completed",
    });

    expect(seeded.id).toBe("p1");
    expect(seeded.shardId).toBeDefined();

    const fetched = await fixture.getPayment("G_SENDER_ADDR_1", "p1");
    expect(fetched).toEqual(seeded);

    const distribution = await fixture.verifyDataDistribution();
    expect(Object.keys(distribution)).toEqual(["shard-1", "shard-2"]);
    expect(distribution["shard-1"] + distribution["shard-2"]).toBe(1);

    await fixture.cleanup();
    const afterClean = await fixture.getPayment("G_SENDER_ADDR_1", "p1");
    expect(afterClean).toBeNull();
  });

  it("ensures no files in src/lib have test/fixture/mock suffixes", () => {
    function walk(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          files.push(...walk(fullPath));
        } else {
          files.push(fullPath);
        }
      }
      return files;
    }

    const libFiles = walk(path.join(ROOT, "src/lib"));
    const strayTestModules = libFiles.filter((file) => {
      const base = path.basename(file);
      // ab-test.ts and webhook-test.ts are production runtime features
      if (base === "ab-test.ts" || base === "webhook-test.ts") return false;
      return (
        base.includes(".test.") ||
        base.includes(".spec.") ||
        base.includes("test-fixture") ||
        base.includes("test-factory")
      );
    });

    expect(strayTestModules).toEqual([]);
  });
});
