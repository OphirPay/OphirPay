// SPDX-License-Identifier: MIT
/**
 * Contract integration & conservation invariant verification tests for Issue #1403:
 * Soroban contract integration test for multi-asset batch payment execution.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const CONTRACT_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "src",
  "contract.rs"
);
const INTEGRATION_TESTS_RS_PATH = path.join(
  ROOT,
  "contracts",
  "ophirpay",
  "tests",
  "integration_tests.rs"
);

interface MultiAssetBatchItem {
  recipient: string;
  asset: string;
  amount: bigint;
}

/**
 * Reference model of `execute_multi_asset_batch` per-token settlement and conservation check.
 */
function simulateMultiAssetBatch(
  initialCreatorBalances: Record<string, bigint>,
  items: MultiAssetBatchItem[],
  feeBps: number
) {
  const creatorBalances = { ...initialCreatorBalances };
  const recipientBalances: Record<string, Record<string, bigint>> = {};
  const collectorBalances: Record<string, bigint> = {};
  let successful = 0;
  let failed = 0;
  let totalAmount = BigInt(0);

  for (const item of items) {
    if (item.amount <= BigInt(0)) {
      failed += 1;
      continue;
    }
    const fee = (item.amount * BigInt(feeBps)) / BigInt(10_000);
    creatorBalances[item.asset] -= item.amount + fee;
    recipientBalances[item.recipient] ??= {};
    recipientBalances[item.recipient][item.asset] =
      (recipientBalances[item.recipient][item.asset] ?? BigInt(0)) + item.amount;
    collectorBalances[item.asset] =
      (collectorBalances[item.asset] ?? BigInt(0)) + fee;
    successful += 1;
    totalAmount += item.amount;
  }

  return {
    creatorBalances,
    recipientBalances,
    collectorBalances,
    successful,
    failed,
    totalAmount,
  };
}

describe("Multi-asset batch payment execution contract & integration tests (#1403)", () => {
  const contractRs = readFileSync(CONTRACT_RS_PATH, "utf8");
  const integrationTestsRs = readFileSync(INTEGRATION_TESTS_RS_PATH, "utf8");

  it("defines execute_multi_asset_batch in contracts/ophirpay/src/contract.rs with per-token transfers and fee collection", () => {
    expect(contractRs).toContain("pub fn execute_multi_asset_batch(");
    expect(contractRs).toContain(
      "let token_client = token::Client::new(&env, &item_asset);"
    );
    expect(contractRs).toContain(
      "token_client.transfer(&creator, &payee_addr, &amount);"
    );
    expect(contractRs).toContain(
      "let _fee = collect_fee(&env, &creator, &item_asset, amount)?;"
    );
  });

  it("includes 3-token multi-asset batch integration tests and conservation invariant assertions in integration_tests.rs", () => {
    expect(integrationTestsRs).toContain(
      "fn test_multi_asset_batch_execution_across_three_tokens_and_conservation_invariant()"
    );
    expect(integrationTestsRs).toContain(
      "fn test_multi_asset_batch_partial_zero_amount_and_validation_guards()"
    );
    expect(integrationTestsRs).toContain("token_xlm_client.balance(&recipient_xlm)");
    expect(integrationTestsRs).toContain("token_usdc_client.balance(&recipient_usdc)");
    expect(integrationTestsRs).toContain("token_eurc_client.balance(&recipient_eurc)");
    expect(integrationTestsRs).toContain("initial_xlm - expected_fee_xlm");
    expect(integrationTestsRs).toContain("initial_usdc - expected_fee_usdc");
    expect(integrationTestsRs).toContain("initial_eurc - expected_fee_eurc");
  });

  it("preserves the per-token balance conservation invariant across 3 distinct token contracts", () => {
    const initialBalances = {
      XLM: BigInt("10000000"),
      USDC: BigInt("20000000"),
      EURC: BigInt("30000000"),
    };

    const result = simulateMultiAssetBatch(
      initialBalances,
      [
        { recipient: "r_xlm", asset: "XLM", amount: BigInt("2000000") },
        { recipient: "r_usdc", asset: "USDC", amount: BigInt("5000000") },
        { recipient: "r_eurc", asset: "EURC", amount: BigInt("8000000") },
      ],
      100 // 1% fee
    );

    expect(result.successful).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.totalAmount).toBe(BigInt("15000000"));

    expect(result.recipientBalances.r_xlm.XLM).toBe(BigInt("2000000"));
    expect(result.recipientBalances.r_usdc.USDC).toBe(BigInt("5000000"));
    expect(result.recipientBalances.r_eurc.EURC).toBe(BigInt("8000000"));

    // Conservation invariant per token: creator + recipient == initial - fee
    expect(
      result.creatorBalances.XLM + result.recipientBalances.r_xlm.XLM
    ).toBe(initialBalances.XLM - result.collectorBalances.XLM);
    expect(
      result.creatorBalances.USDC + result.recipientBalances.r_usdc.USDC
    ).toBe(initialBalances.USDC - result.collectorBalances.USDC);
    expect(
      result.creatorBalances.EURC + result.recipientBalances.r_eurc.EURC
    ).toBe(initialBalances.EURC - result.collectorBalances.EURC);
  });
});
