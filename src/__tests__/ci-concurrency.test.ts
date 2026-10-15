// SPDX-License-Identifier: MIT

/**
 * Issue #1343: CI concurrency cancels post-merge runs on main / integration/staging
 * when commits land in quick succession.
 *
 * Verifies that:
 * 1. `ci.yml` concurrency cancel-in-progress is scoped only to pull requests.
 * 2. `ci.yml` concurrency group incorporates github.sha on push events so merges are not cancelled.
 * 3. `on.push.branches` and `on.pull_request.branches` both include main and integration/staging.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const workflowPath = join(process.cwd(), ".github", "workflows", "ci.yml");

describe("CI concurrency configuration (#1343)", () => {
  it("ci.yml exists", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  const raw = readFileSync(workflowPath, "utf8");
  const parsed = load(raw) as Record<string, unknown>;

  it("parses as valid YAML", () => {
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  it("triggers on push to both main and integration/staging", () => {
    const onBlock = parsed.on as {
      push?: { branches?: string[] };
      pull_request?: { branches?: string[] };
    };
    expect(onBlock.push).toBeDefined();
    expect(onBlock.push?.branches).toContain("main");
    expect(onBlock.push?.branches).toContain("integration/staging");
  });

  it("triggers on pull_request to both main and integration/staging", () => {
    const onBlock = parsed.on as {
      push?: { branches?: string[] };
      pull_request?: { branches?: string[] };
    };
    expect(onBlock.pull_request).toBeDefined();
    expect(onBlock.pull_request?.branches).toContain("main");
    expect(onBlock.pull_request?.branches).toContain("integration/staging");
  });

  it("only cancels in progress for pull_request events", () => {
    expect(raw).toMatch(/cancel-in-progress:\s*\${{\s*github\.event_name\s*==\s*'pull_request'\s*}}/);
  });

  it("isolates concurrency group by commit sha on push events", () => {
    expect(raw).toMatch(/group:\s*\${{\s*github\.workflow\s*}}-\${{\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*github\.ref\s*\|\|\s*github\.sha\s*}}/);
  });
});
