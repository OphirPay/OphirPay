// SPDX-License-Identifier: MIT
//
// Keeps docs/ERROR_CODES.md honest. The table is generated, so the risk is not
// that someone edits it by hand but that someone adds a code and forgets to
// re-run the generator. This test fails in that case.
//
// It also guards the opposite failure: a code in the doc that no longer exists
// in the source, which would leave an integrator branching on a dead value.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ERROR_STATUS } from "@/lib/error-codes";
import { parseCatalog, isRetryable } from "../../scripts/generate-error-docs";

const PROJECT_ROOT = process.cwd();
const docPath = resolve(PROJECT_ROOT, "docs/ERROR_CODES.md");
const codesPath = resolve(PROJECT_ROOT, "src/lib/error-codes.ts");

const doc = readFileSync(docPath, "utf8");
const source = readFileSync(codesPath, "utf8");

/** Codes the doc claims exist, from the table rows. */
function documentedCodes(): Set<string> {
  const out = new Set<string>();
  for (const m of doc.matchAll(/^\| `([A-Z0-9_]+)` \| (yes|no) \|$/gm)) {
    out.add(m[1]);
  }
  return out;
}

function documentedRetries(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const m of doc.matchAll(/^\| `([A-Z0-9_]+)` \| (yes|no) \|$/gm)) {
    out.set(m[1], m[2] === "yes");
  }
  return out;
}

describe("docs/ERROR_CODES.md — coverage", () => {
  it("is marked auto-generated", () => {
    expect(doc).toContain("AUTO-GENERATED");
  });

  it("lists every code in ERROR_STATUS", () => {
    const documented = documentedCodes();
    const missing = Object.keys(ERROR_STATUS).filter((c) => !documented.has(c));
    expect(
      missing,
      `Codes added without regenerating the doc. Run: npm run generate-error-docs`
    ).toEqual([]);
  });

  it("lists no code that has been removed from the source", () => {
    const live = new Set(Object.keys(ERROR_STATUS));
    const stale = [...documentedCodes()].filter((c) => !live.has(c));
    expect(stale, `Doc lists codes that no longer exist. Run: npm run generate-error-docs`).toEqual(
      []
    );
  });

  it("documents exactly as many codes as the source defines", () => {
    expect(documentedCodes().size).toBe(Object.keys(ERROR_STATUS).length);
  });
});

describe("docs/ERROR_CODES.md — the retryable column is derived, not guessed", () => {
  it("agrees with isRetryable for every documented code", () => {
    const rows = parseCatalog(source);
    const retries = documentedRetries();
    const mismatches: string[] = [];

    for (const row of rows) {
      const documented = retries.get(row.code);
      if (documented === undefined) {
        mismatches.push(`${row.code}: missing from doc`);
      } else if (documented !== row.retryable) {
        mismatches.push(
          `${row.code}: doc says ${documented ? "yes" : "no"}, isRetryable says ${
            row.retryable ? "yes" : "no"
          }`
        );
      }
    }

    expect(mismatches, `Retryable column drifted. Run: npm run generate-error-docs`).toEqual([]);
  });

  it("never marks a 4xx validation code as retryable", () => {
    // 400/422 mean the request itself is wrong; replaying it unchanged cannot
    // help and can only burn quota.
    const rows = parseCatalog(source).filter((r) => r.status === 400 || r.status === 422);
    const bad = rows.filter((r) => r.retryable).map((r) => r.code);
    expect(bad).toEqual([]);
  });

  it("never marks a 401/403/404 as retryable without a new credential", () => {
    const rows = parseCatalog(source).filter(
      (r) => r.status === 401 || r.status === 403 || r.status === 404
    );
    const bad = rows.filter((r) => r.retryable).map((r) => r.code);
    expect(bad).toEqual([]);
  });

  it("marks 429 and 503 as retryable", () => {
    const rows = parseCatalog(source);
    for (const status of [429, 503]) {
      for (const r of rows.filter((x) => x.status === status)) {
        expect(isRetryable(r.code, r.status), `${r.code} (${status})`).toBe(true);
      }
    }
  });

  it("keeps already-applied on-chain conflicts terminal", () => {
    // Regression guard for the dangerous class: a 409 that follows a partially
    // applied write must not be replayed.
    const rows = parseCatalog(source);
    const conflicts = rows.filter((r) => r.status === 409);
    const alreadyApplied = conflicts.filter((r) => /ALREADY|DUPLICATE|IDEMPOTENCY/.test(r.code));
    for (const r of alreadyApplied) {
      expect(
        isRetryable(r.code, r.status),
        `${r.code} looks already-applied and must stay terminal`
      ).toBe(false);
    }
  });
});

describe("docs/ERROR_CODES.md — structure", () => {
  it("groups codes under their HTTP status headings", () => {
    const statuses = new Set([...doc.matchAll(/^### (\d{3})/gm)].map((m) => Number(m[1])));
    const expected = new Set(Object.values(ERROR_STATUS).map(Number));
    for (const s of expected) {
      expect(statuses.has(s), `no heading for ${s}`).toBe(true);
    }
  });

  it("explains the retry contract rather than only listing codes", () => {
    expect(doc).toContain("## Retrying");
    expect(doc).toContain("RETRY_TERMINAL");
    expect(doc).toMatch(/idempotency key/i);
  });
});

describe("generate-error-docs script wiring", () => {
  it("is registered in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["generate-error-docs"]).toContain("generate-error-docs.ts");
  });

  it("has a working tsx runner available", () => {
    // `npm run generate-errors` has the same dependency on tsx, but tsx is not
    // listed in devDependencies, so that script only works when npx downloads
    // it on demand. For the new script, add tsx to devDependencies rather than
    // relying on npx — an undeclared runner is a broken runner in CI.
    const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8"));
    const declared = Boolean(pkg.devDependencies?.tsx ?? pkg.dependencies?.tsx);
    expect(
      declared,
      "scripts/generate-error-docs.ts runs with tsx but tsx is not a declared dependency; add it to devDependencies so the script works from a clean `npm ci`"
    ).toBe(true);
  });
});
