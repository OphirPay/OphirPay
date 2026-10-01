// SPDX-License-Identifier: MIT

/**
 * Keeps `packages/ophirpay-client/operations.generated.*` in lock-step with the
 * committed OpenAPI spec (issue #822). If someone edits `docs/openapi.yaml`
 * without regenerating, this fails CI with the exact command to run.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const SCRIPT = join(process.cwd(), "scripts", "generate-api-client.mjs");

describe("generated API client catalogue", () => {
  it("is up to date with docs/openapi.yaml", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--check"], {
      encoding: "utf8",
    });
    expect(out).toContain("up to date");
  });

  it("contains a callable operation for every spec path", () => {
    const js = readFileSync(
      join(process.cwd(), "packages", "ophirpay-client", "operations.generated.js"),
      "utf8"
    );
    expect(js).toContain("GENERATED FROM docs/openapi.yaml");
    expect(js).toMatch(/"name": "postApiPayments"/);
    expect(js).toMatch(/"name": "getApiPaymentsId"/);
    expect(js).toMatch(/"path": "\/api\/payments\/\{id\}"/);
  });
});
