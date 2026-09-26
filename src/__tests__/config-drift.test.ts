// SPDX-License-Identifier: MIT
//
// Config & documentation drift guard — issues #678, #679, #680, #682.
//
// The files under test here are consumed by tooling that fails *silently* when
// it references a path or a count that no longer exists: actions/labeler
// quietly stops labelling, a self-referential Vercel rewrite quietly does
// nothing, a stale CSP comment quietly sends contributors to a file that isn't
// there, and a decorative README badge quietly lies about what gates a merge.
//
// Each assertion below turns one of those silent failures into a loud test
// failure so the next rename cannot reintroduce the same rot.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");
const exists = (relPath: string): boolean => existsSync(join(root, relPath));

const WILDCARD = /[*?\[\]{]/;

type LabelerEntry = { "changed-files"?: Array<Record<string, string | string[]>> };
type LabelerConfig = Record<string, LabelerEntry[]>;

/** Recursively collect every value stored under a `*-glob-to-any-file` key. */
function globsIn(node: unknown, acc: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) globsIn(item, acc);
    return acc;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.includes("glob")) {
        if (typeof value === "string") acc.push(value);
        else if (Array.isArray(value)) {
          for (const v of value) if (typeof v === "string") acc.push(v);
        }
      } else {
        globsIn(value, acc);
      }
    }
  }
  return acc;
}

describe("PR labeler config (.github/labeler.yml) — #680", () => {
  const labeler = load(read(".github/labeler.yml")) as LabelerConfig;

  it("references src/proxy.ts instead of the removed src/middleware.ts", () => {
    const raw = read(".github/labeler.yml");
    expect(raw).toContain("src/proxy.ts");
    expect(raw).not.toContain("src/middleware.ts");
  });

  it("labels src/proxy.ts changes as both backend and security", () => {
    expect(globsIn(labeler["🔧 backend"])).toContain("src/proxy.ts");
    expect(globsIn(labeler["🔒 security"])).toContain("src/proxy.ts");
  });

  it("routes auth/session/CSRF surface changes through the security group", () => {
    const security = globsIn(labeler["🔒 security"]);
    expect(security).toContain("src/lib/api-auth.ts");
    expect(security).toContain("src/lib/auth-session.ts");
    expect(security).toContain("src/lib/csrf.ts");
  });

  it("has no glob pointing at a path that does not exist", () => {
    for (const glob of globsIn(labeler)) {
      if (!WILDCARD.test(glob)) {
        expect(exists(glob), `labeler references a missing path: ${glob}`).toBe(true);
        continue;
      }
      // For a wildcard glob, the static prefix before the first wildcard must
      // resolve to a real directory (e.g. "src/app/**" -> "src/app").
      const staticPrefix = glob.slice(0, glob.search(WILDCARD));
      const dir = staticPrefix.endsWith("/") ? staticPrefix.slice(0, -1) : dirname(staticPrefix);
      if (!dir || dir === ".") continue;
      expect(exists(dir), `labeler glob "${glob}" is rooted at a missing directory: ${dir}`).toBe(true);
    }
  });
});

describe("removed src/middleware.ts is not referenced by tooling config", () => {
  for (const file of [".github/labeler.yml", ".github/CODEOWNERS", "next.config.ts", "vercel.json"]) {
    it(`${file} does not reference src/middleware.ts`, () => {
      expect(read(file)).not.toContain("src/middleware.ts");
    });
  }

  it(".github/CODEOWNERS still assigns ownership for src/proxy.ts", () => {
    expect(read(".github/CODEOWNERS")).toContain("src/proxy.ts");
  });
});

describe("Vercel rewrites (vercel.json) — #682", () => {
  const config = JSON.parse(read("vercel.json")) as {
    rewrites?: Array<{ source?: string; destination?: string }>;
  };

  it("contains no self-referential (no-op) rewrite", () => {
    for (const rule of config.rewrites ?? []) {
      expect(rule.destination, `no-op rewrite: ${rule.source} -> ${rule.destination}`).not.toBe(
        rule.source
      );
    }
  });

  it("still serves security.txt from the repository file", () => {
    expect(exists(".well-known/security.txt")).toBe(true);
    expect(read(".well-known/security.txt")).toMatch(/^Contact:/m);
  });
});

describe("CSP documentation (next.config.ts) — #679", () => {
  const config = read("next.config.ts");

  it("points contributors at src/proxy.ts", () => {
    expect(config).toContain("src/proxy.ts");
  });

  it("keeps the documented policy in sync with src/proxy.ts (unsafe-inline retained)", () => {
    // src/proxy.ts keeps 'unsafe-inline' because the per-request nonce never
    // reaches the App Router renderer; the comment must not overstate the
    // policy by claiming a nonce-based CSP that is not in place.
    expect(read("src/proxy.ts")).toContain("'unsafe-inline'");
    expect(config).toContain("unsafe-inline");
  });
});

describe("README CI documentation — #678", () => {

  it("contains no reference to the removed 22-job pipeline", () => {
    for (const file of ["README.md", "README.es.md", "README.fr.md", "README.ja.md"]) {
      expect(read(file), `${file} still advertises a 22-job pipeline`).not.toMatch(
        /22\s*(jobs|trabajos|ジョブ)/
      );
    }
  });

  it("names the sibling workflows that actually run", () => {
    const readme = read("README.md");
    for (const workflow of [
      "ci.yml",
      "contract-regression.yml",
      "dependency-scan.yml",
      "prisma-ci.yml",
      "pr-labeler.yml",
      "enforce-integration-branch.yml",
      "scorecard.yml",
      "stale.yml",
      "db-backup.yml",
      "scheduled-payments-cron.yml",
    ]) {
      expect(readme, `README should mention ${workflow}`).toContain(workflow);
    }
  });
});
