// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scriptPath = join(process.cwd(), "scripts", "deploy-workflow.sh");
const script = readFileSync(scriptPath, "utf8");

describe("deploy-workflow.sh PUBLIC (mainnet) configuration", () => {
  it("supports a PUBLIC network mode", () => {
    expect(script).toContain('NETWORK_MODE="${NETWORK_MODE:-TESTNET}"');
    expect(script).toContain('if [ "$NETWORK_MODE" = "PUBLIC" ]');
  });

  it("targets the mainnet Soroban RPC in PUBLIC mode", () => {
    expect(script).toContain("https://soroban.stellar.org:443");
  });

  it("targets the mainnet Horizon URL in PUBLIC mode", () => {
    expect(script).toContain("https://horizon.stellar.org");
  });

  it("uses the mainnet network passphrase in PUBLIC mode", () => {
    expect(script).toContain("Public Global Stellar Network ; September 2015");
  });

  it("disables friendbot in PUBLIC mode", () => {
    expect(script).toContain("FRIENDBOT_ENABLED=false");
  });

  it("passes --network public to the stellar CLI in PUBLIC mode", () => {
    expect(script).toContain('NETWORK_FLAG="--network public"');
  });

  it("has a dry-run that fails before any real submission in PUBLIC mode", () => {
    expect(script).toContain('DRY_RUN="${DRY_RUN:-false}"');
    expect(script).toContain("refusing to submit any transaction to PUBLIC network");
    expect(script).toContain("exit 1");
  });

  it("uses the mainnet explorer URL in the summary for PUBLIC mode", () => {
    expect(script).toContain("https://stellar.expert/explorer/public/contract/");
  });
});

describe("deploy-workflow.sh TESTNET configuration", () => {
  it("defaults to the testnet RPC URL", () => {
    expect(script).toContain("https://soroban-testnet.stellar.org:443");
  });

  it("defaults to the testnet Horizon URL", () => {
    expect(script).toContain("https://horizon-testnet.stellar.org");
  });

  it("uses the testnet network passphrase", () => {
    expect(script).toContain("Test SDF Network ; September 2015");
  });

  it("passes --network testnet to the stellar CLI", () => {
    expect(script).toContain('NETWORK_FLAG="--network testnet"');
  });
});
