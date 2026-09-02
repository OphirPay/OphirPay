// SPDX-License-Identifier: MIT
//
// Content tests for the cross-contract communication deep-dive (issue #31).
// These guard the acceptance criteria: the doc must explain the OphirPay →
// Emitter invocation via env.invoke_contract, why the concerns are split, how
// to extend the pattern, include a sequence diagram and a worked code excerpt
// from contracts/ophirpay/src/lib.rs, and be linked from README and
// docs/architecture.md.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const docPath = path.join(root, "docs", "CONTRACT_ARCHITECTURE.md");
const readmePath = path.join(root, "README.md");
const architecturePath = path.join(root, "docs", "architecture.md");

describe("docs/CONTRACT_ARCHITECTURE.md (cross-contract deep-dive)", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

  it("explains the OphirPay → Emitter invocation via env.invoke_contract", () => {
    expect(doc).toMatch(/env\.invoke_contract/);
    expect(doc).toMatch(/OphirPay/);
    expect(doc).toMatch(/Emitter/);
    expect(doc).toMatch(/Symbol::new/);
  });

  it("explains why the concerns are split", () => {
    expect(doc).toMatch(/Why the concerns are split/i);
    expect(doc).toMatch(/PaymentEventEmitter/);
  });

  it("includes a sequence diagram", () => {
    expect(doc).toMatch(/```mermaid/);
    expect(doc).toMatch(/sequenceDiagram/);
    expect(doc).toMatch(/invoke_contract\("pause", \[owner\]\)/);
  });

  it("includes a worked code excerpt from contracts/ophirpay/src/lib.rs", () => {
    expect(doc).toMatch(/emergency_pause_all/);
    expect(doc).toMatch(/require_owner/);
    expect(doc).toMatch(/acquire_reentrancy_lock/);
    expect(doc).toMatch(/result\.map_err/);
    expect(doc).toMatch(/CrossContractCallFailed/);
  });

  it("documents the callee-side access control in contracts/emitter/src/lib.rs", () => {
    expect(doc).toMatch(/pub fn pause/);
    expect(doc).toMatch(/caller\.require_auth/);
    expect(doc).toMatch(/EmitterError::Unauthorized/);
  });

  it("explains how to extend the pattern to new contracts", () => {
    expect(doc).toMatch(/Extending the pattern/i);
    expect(doc).toMatch(/Checklist for a new cross-contract function/);
  });

  it("describes why the sub-call result must be propagated", () => {
    expect(doc).toMatch(/result must be propagated/i);
    expect(doc).toMatch(/Invariant:/);
  });
});

describe("cross-contract doc links", () => {
  it("is linked from README.md", () => {
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
    expect(readme).toMatch(/docs\/CONTRACT_ARCHITECTURE\.md/);
  });

  it("is linked from docs/architecture.md", () => {
    const arch = existsSync(architecturePath)
      ? readFileSync(architecturePath, "utf8")
      : "";
    expect(arch).toMatch(/CONTRACT_ARCHITECTURE\.md/);
  });
});
