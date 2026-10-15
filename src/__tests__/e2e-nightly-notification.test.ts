// SPDX-License-Identifier: MIT

/**
 * Issue #1342: Nightly E2E failures are silent.
 *
 * Verifies that:
 * 1. e2e-nightly.yml workflow parses cleanly as valid YAML.
 * 2. Workflow declares issues: write permission.
 * 3. A notify-status job runs if: always() after playwright-tests and merge-reports.
 * 4. Failing runs open or comment on a tracking issue labelled 'ci'.
 * 5. Successful green runs close any open tracking issue.
 * 6. Issue body contains links to the workflow run and merged report artifact.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const workflowPath = join(process.cwd(), ".github", "workflows", "e2e-nightly.yml");

describe("Nightly E2E failure tracking (#1342)", () => {
  it("workflow file exists", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  const raw = readFileSync(workflowPath, "utf8");
  const parsed = load(raw) as Record<string, unknown>;

  it("parses as valid YAML", () => {
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  it("declares issues: write permission", () => {
    const permissions = parsed.permissions as Record<string, string>;
    expect(permissions).toBeDefined();
    expect(permissions.issues).toBe("write");
    expect(permissions.contents).toBe("read");
  });

  it("declares a notify-status job depending on playwright-tests and merge-reports", () => {
    const jobs = parsed.jobs as Record<string, { needs?: string[]; if?: string }>;
    expect(jobs).toBeDefined();
    expect(jobs["notify-status"]).toBeDefined();
    expect(jobs["notify-status"].needs).toEqual(
      expect.arrayContaining(["playwright-tests", "merge-reports"]),
    );
    expect(jobs["notify-status"].if).toBe("always()");
  });

  it("handles issue creation and comment on failure", () => {
    expect(raw).toContain('TITLE="Nightly E2E failing on ${{ github.ref_name }}"');
    expect(raw).toContain("gh issue create");
    expect(raw).toContain("gh issue comment");
    expect(raw).toContain('--label "ci"');
    expect(raw).toContain("$RUN_URL#artifacts");
  });

  it("handles issue closing on green run recovery", () => {
    expect(raw).toContain("gh issue close");
    expect(raw).toContain('needs.playwright-tests.result }}" != "success"');
  });
});
