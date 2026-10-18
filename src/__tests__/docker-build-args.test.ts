// SPDX-License-Identifier: MIT

/**
 * Issue #1329 — Dockerfile must support build args for NEXT_PUBLIC_* variables.
 *
 * Next.js inlines NEXT_PUBLIC_* variables at build time. Without ARG/ENV in the
 * builder stage, CI-built Docker images ship without contract IDs, network,
 * or RPC config, and docker-smoke tests cannot verify client-side bundle inlining.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const dockerfilePath = join(repoRoot, "Dockerfile");
const dockerSmokePath = join(repoRoot, ".github", "workflows", "docker-smoke.yml");
const deploymentDocPath = join(repoRoot, "docs", "DEPLOYMENT.md");

describe("Dockerfile build args for NEXT_PUBLIC_* (#1329)", () => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");

  // Extract the builder stage
  const builderStageMatch = dockerfile.match(/FROM node:24-slim AS builder([\s\S]*?)FROM node:24-slim AS runner/);
  const builderStage = builderStageMatch ? builderStageMatch[1] : "";

  it("extracts builder stage from Dockerfile", () => {
    expect(builderStage).not.toBe("");
  });

  const expectedVars = [
    "NEXT_PUBLIC_STELLAR_NETWORK",
    "NEXT_PUBLIC_STELLAR_RPC_URL",
    "NEXT_PUBLIC_STELLAR_HORIZON_URL",
    "NEXT_PUBLIC_CONTRACT_ID",
    "NEXT_PUBLIC_EMITTER_CONTRACT_ID",
    "NEXT_PUBLIC_APP_URL",
  ];

  it.each(expectedVars)("builder stage declares ARG for %s", (varName) => {
    const argRegex = new RegExp(`ARG\\s+${varName}=`);
    expect(builderStage).toMatch(argRegex);
  });

  it.each(expectedVars)("builder stage declares ENV for %s", (varName) => {
    const envRegex = new RegExp(`ENV\\s+${varName}=\\$${varName}`);
    expect(builderStage).toMatch(envRegex);
  });

  it("sets testnet defaults matching .env.example", () => {
    expect(builderStage).toContain("ARG NEXT_PUBLIC_STELLAR_NETWORK=TESTNET");
    expect(builderStage).toContain("ARG NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443");
    expect(builderStage).toContain("ARG NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org");
    expect(builderStage).toContain("ARG NEXT_PUBLIC_CONTRACT_ID=CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
    expect(builderStage).toContain("ARG NEXT_PUBLIC_EMITTER_CONTRACT_ID=CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN");
    expect(builderStage).toContain("ARG NEXT_PUBLIC_APP_URL=http://localhost:3000");
  });
});

describe("docker-smoke.yml build-args and client bundle assertion (#1329)", () => {
  const dockerSmoke = readFileSync(dockerSmokePath, "utf8");

  it("passes build-args to docker/build-push-action", () => {
    expect(dockerSmoke).toContain("build-args:");
    expect(dockerSmoke).toContain("NEXT_PUBLIC_CONTRACT_ID=CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
    expect(dockerSmoke).toContain("NEXT_PUBLIC_EMITTER_CONTRACT_ID=CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN");
  });

  it("includes assertion step verifying client bundle inlines the contract ID", () => {
    expect(dockerSmoke).toMatch(/Assert client bundle contains inlined contract ID/);
    expect(dockerSmoke).toContain("/app/.next/static/");
    expect(dockerSmoke).toContain("CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET");
  });
});

describe("docs/DEPLOYMENT.md Docker build args documentation (#1329)", () => {
  const deploymentDoc = readFileSync(deploymentDocPath, "utf8");

  it("documents build-time inlining and --build-arg usage", () => {
    expect(deploymentDoc).toContain("Build-Time Configuration (`NEXT_PUBLIC_*`)");
    expect(deploymentDoc).toContain("--build-arg NEXT_PUBLIC_CONTRACT_ID=");
    expect(deploymentDoc).toContain("--build-arg NEXT_PUBLIC_STELLAR_NETWORK=TESTNET");
    expect(deploymentDoc).toContain("--build-arg NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC");
  });
});
