// SPDX-License-Identifier: MIT
/**
 * Tests for CI concurrency configuration (issue #1343).
 *
 * Acceptance Criteria:
 * - Two quick merges to a protected branch both get complete CI runs
 * - Superseded PR runs are still cancelled
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("CI workflow concurrency (issue #1343)", () => {
  it("only cancels runs in progress for pull_request events", () => {
    const raw = read(".github/workflows/ci.yml");
    const parsed = load(raw) as {
      concurrency: {
        group: string;
        "cancel-in-progress": string | boolean;
      };
    };

    expect(parsed.concurrency).toBeDefined();
    expect(parsed.concurrency["cancel-in-progress"]).toBe(
      "${{ github.event_name == 'pull_request' }}"
    );
  });
});
