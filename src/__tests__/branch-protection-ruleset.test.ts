// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const RULESET_PATH = path.join(
  ROOT,
  ".github",
  "rulesets",
  "branch-protection.json"
);
const MERGE_GATE_PATH = path.join(ROOT, "docs", "MERGE_GATE.md");

interface RulesetRule {
  type: string;
  parameters?: {
    required_approving_review_count?: number;
    required_review_thread_resolution?: boolean;
    required_status_checks?: Array<{ context: string }>;
  };
}

interface RepositoryRuleset {
  name: string;
  target: string;
  enforcement: string;
  bypass_actors: Array<{
    actor_id: number;
    actor_type: string;
    bypass_mode: string;
  }>;
  conditions: {
    ref_name: {
      include: string[];
      exclude: string[];
    };
  };
  rules: RulesetRule[];
}

describe("branch protection ruleset (#1318)", () => {
  const ruleset: RepositoryRuleset = JSON.parse(
    readFileSync(RULESET_PATH, "utf8")
  );

  it("is active and targets both main and integration/staging branches", () => {
    expect(ruleset.target).toBe("branch");
    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.conditions.ref_name.include).toEqual(
      expect.arrayContaining([
        "refs/heads/main",
        "refs/heads/integration/staging",
      ])
    );
  });

  it("blocks force-pushes and branch deletion except by repository admins", () => {
    const ruleTypes = ruleset.rules.map((r) => r.type);
    expect(ruleTypes).toContain("deletion");
    expect(ruleTypes).toContain("non_fast_forward");
    expect(ruleset.bypass_actors).toEqual([
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "always",
      },
    ]);
  });

  it("requires pull requests and all merge-gate status checks before merging", () => {
    const prRule = ruleset.rules.find((r) => r.type === "pull_request");
    expect(prRule).toBeDefined();
    expect(prRule?.parameters?.required_approving_review_count).toBeGreaterThanOrEqual(1);

    const statusRule = ruleset.rules.find(
      (r) => r.type === "required_status_checks"
    );
    expect(statusRule).toBeDefined();
    const contexts =
      statusRule?.parameters?.required_status_checks?.map((c) => c.context) ??
      [];

    expect(contexts).toEqual(
      expect.arrayContaining([
        "1️⃣ Frontend — Lint (ESLint)",
        "2️⃣ Frontend — TypeCheck (tsc)",
        "3️⃣ Frontend — Unit Tests (Vitest)",
        "9️⃣ Frontend — Build (Next.js)",
        "1️⃣0️⃣ Deploy — Config Guards",
        "5️⃣ Backend — Contracts (WASM + Tests)",
        "1️⃣2️⃣ Security — Secrets (Gitleaks)",
        "1️⃣9️⃣ Infra — Helm (Lint + Render)",
        "🚧 Enforce Integration Branch",
      ])
    );
  });

  it("is referenced from docs/MERGE_GATE.md", () => {
    const mergeGateDoc = readFileSync(MERGE_GATE_PATH, "utf8");
    expect(mergeGateDoc).toContain(".github/rulesets/branch-protection.json");
  });
});
