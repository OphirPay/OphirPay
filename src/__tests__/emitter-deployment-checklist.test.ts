// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

describe("Emitter Allow-List Deployment Checklist & Verification (#782)", () => {
  const rootDir = process.cwd();
  const runbookPath = path.join(rootDir, "docs/MAINNET_RUNBOOK.md");
  const deploymentGuidePath = path.join(rootDir, "docs/deployment-mainnet.md");
  const verifyScriptPath = path.join(rootDir, "scripts/verify-emitter-allowlist.sh");

  it("verifies docs/MAINNET_RUNBOOK.md contains the exact call order, ownership rules, and skipping consequences", () => {
    expect(fs.existsSync(runbookPath)).toBe(true);
    const content = fs.readFileSync(runbookPath, "utf-8");

    // Call order and set_allowed_source
    expect(content).toContain("set_allowed_source");
    expect(content).toContain("Configure emitter allow-list");
    expect(content).toContain("Deploy & init `PaymentEventEmitter`");
    expect(content).toContain("Deploy & init `OphirPayContract`");

    // Ownership requirement
    expect(content).toContain("emitter owner strictly matches orchestrator owner");
    expect(content).toContain("emergency_pause_all");

    // Consequence documentation
    expect(content).toContain("EmitterError::Unauthorized");
    expect(content).toContain("breaking the SSE stream");

    // Verification step
    expect(content).toContain("verify-emitter-allowlist.sh");
    expect(content).toContain("get_allowed_source");
  });

  it("verifies docs/deployment-mainnet.md contains allow-list configuration and verification checklist", () => {
    expect(fs.existsSync(deploymentGuidePath)).toBe(true);
    const content = fs.readFileSync(deploymentGuidePath, "utf-8");

    expect(content).toContain("Configure Emitter Allow-List");
    expect(content).toContain("set_allowed_source");
    expect(content).toContain("Consequences of Skipping");
    expect(content).toContain("EmitterError::Unauthorized");
    expect(content).toContain("verify-emitter-allowlist.sh");
  });

  it("ensures scripts/verify-emitter-allowlist.sh exists and passes syntax check", () => {
    expect(fs.existsSync(verifyScriptPath)).toBe(true);
    expect(() => {
      execSync(`bash -n "${verifyScriptPath}"`, { stdio: "pipe" });
    }).not.toThrow();
  });

  it("ensures scripts/verify-emitter-allowlist.sh succeeds when allow-list and owner match", () => {
    const env = {
      ...process.env,
      SIMULATION_MODE: "true",
      MOCK_ALLOWED_SOURCE: "CBRCZHMNWOFTWOTCI2WBQ5A5HVKVLO2AXHYIWJ5FVYB45OHLSLWGJGYB",
      MOCK_EMITTER_OWNER: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      MOCK_ORCHESTRATOR_OWNER: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
    };

    const output = execSync(
      `bash "${verifyScriptPath}" CBRCZHMNWOFTWOTCI2WBQ5A5HVKVLO2AXHYIWJ5FVYB45OHLSLWGJGYB CA6LAPR4OWABPWORBQGK5O5H5S62GIPQBKP3PH7H2DQ3ZNSWSH3RHFE4 GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ`,
      { env, encoding: "utf-8" }
    );

    expect(output).toContain("Emitter ALLOWED_SOURCE matches Orchestrator");
    expect(output).toContain("All post-deployment emitter verification checks PASSED");
  });

  it("ensures scripts/verify-emitter-allowlist.sh fails loudly when allow-list is unset or mismatched", () => {
    const env = {
      ...process.env,
      SIMULATION_MODE: "true",
      MOCK_ALLOWED_SOURCE: "",
      MOCK_EMITTER_OWNER: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
      MOCK_ORCHESTRATOR_OWNER: "GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ",
    };

    let failed = false;
    try {
      execSync(
        `bash "${verifyScriptPath}" CBRCZHMNWOFTWOTCI2WBQ5A5HVKVLO2AXHYIWJ5FVYB45OHLSLWGJGYB CA6LAPR4OWABPWORBQGK5O5H5S62GIPQBKP3PH7H2DQ3ZNSWSH3RHFE4 GBQMIN7KLT4R473IGGFBGUYM2UNPGKZRTX2LZ4M2KQIY2ASYJL6ACBMZ`,
        { env, encoding: "utf-8", stdio: "pipe" }
      );
    } catch (err: any) {
      failed = true;
      expect(err.status).toBe(1);
      const out = err.stdout?.toString() || err.message;
      expect(out).toContain("Emitter ALLOWED_SOURCE is UNSET or MISMATCHED");
    }
    expect(failed).toBe(true);
  });
});
