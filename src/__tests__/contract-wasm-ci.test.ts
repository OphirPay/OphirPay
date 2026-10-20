// SPDX-License-Identifier: MIT
//
// Contract WASM CI optimization guard tests (issue #1326).
//
// Verifies that:
// 1. .github/workflows/ci.yml installs both binaryen and wabt for wasm-opt and wasm-strip.
// 2. wasm-opt and wasm-strip commands do not swallow failures via `|| true`.
// 3. Optimization verifies tool presence and fails fast if missing.
// 4. Job summary ($GITHUB_STEP_SUMMARY) records before and after sizes for both contracts.
// 5. Binary size growth is rejected and unoptimized backups are cleaned up before artifact upload.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

describe("Contract WASM Optimization in CI (issue #1326)", () => {
  const ciWorkflowPath = ".github/workflows/ci.yml";
  const rawWorkflow = read(ciWorkflowPath);
  const workflow = load(rawWorkflow) as Record<string, any>;

  it("ensures ci.yml is valid YAML and defines the contract-wasm job", () => {
    expect(existsSync(join(root, ciWorkflowPath))).toBe(true);
    expect(workflow).toBeDefined();
    expect(workflow.jobs).toBeDefined();
    expect(workflow.jobs["contract-wasm"]).toBeDefined();
  });

  it("installs both binaryen and wabt (for wasm-strip)", () => {
    const job = workflow.jobs["contract-wasm"];
    const steps = job.steps as Array<{ name?: string; run?: string }>;

    const installStep = steps.find(
      (s) => s.name?.includes("Install Soroban SDK deps") || s.run?.includes("apt-get")
    );
    expect(installStep).toBeDefined();
    expect(installStep?.run).toContain("binaryen");
    expect(installStep?.run).toContain("wabt");
  });

  it("does not swallow optimization failures with || true", () => {
    const job = workflow.jobs["contract-wasm"];
    const steps = job.steps as Array<{ name?: string; run?: string }>;

    const optimizeStep = steps.find((s) => s.name?.includes("Optimize WASM"));
    expect(optimizeStep).toBeDefined();
    expect(optimizeStep?.run).not.toContain("wasm-strip \"$f\" || true");
    expect(optimizeStep?.run).not.toContain("wasm-opt -Oz -o \"$f\" \"${f}\" || true");
    expect(optimizeStep?.run).not.toContain("wasm-opt -Oz -o \"$f\" \"$f\" || true");
  });

  it("verifies optimizer tool presence with fail-fast checks", () => {
    const job = workflow.jobs["contract-wasm"];
    const steps = job.steps as Array<{ name?: string; run?: string }>;

    const optimizeStep = steps.find((s) => s.name?.includes("Optimize WASM"));
    expect(optimizeStep?.run).toContain("command -v wasm-strip");
    expect(optimizeStep?.run).toContain("command -v wasm-opt");
  });

  it("reports before and after sizes in GITHUB_STEP_SUMMARY for both contracts", () => {
    const job = workflow.jobs["contract-wasm"];
    const steps = job.steps as Array<{ name?: string; run?: string }>;

    const optimizeStep = steps.find((s) => s.name?.includes("Optimize WASM"));
    expect(optimizeStep?.run).toContain("GITHUB_STEP_SUMMARY");
    expect(optimizeStep?.run).toContain("ophirpay_contract.wasm");
    expect(optimizeStep?.run).toContain("ophirpay_emitter.wasm");
    expect(optimizeStep?.run).toContain("Before (bytes)");
    expect(optimizeStep?.run).toContain("After (bytes)");
  });

  it("asserts that optimized binary size does not exceed unoptimized size", () => {
    const job = workflow.jobs["contract-wasm"];
    const steps = job.steps as Array<{ name?: string; run?: string }>;

    const optimizeStep = steps.find((s) => s.name?.includes("Optimize WASM"));
    expect(optimizeStep?.run).toMatch(/after_size.*-gt.*before_size/);
  });

  it("cleans up .orig backup files before artifact upload", () => {
    const job = workflow.jobs["contract-wasm"];
    const steps = job.steps as Array<{ name?: string; run?: string }>;

    const optimizeStep = steps.find((s) => s.name?.includes("Optimize WASM"));
    expect(optimizeStep?.run).toContain('rm -f "${f}.orig"');
  });
});
