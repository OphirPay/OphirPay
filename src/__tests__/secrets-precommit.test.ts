// SPDX-License-Identifier: MIT

/**
 * Guards for the local secret-scanning gate (issue #1398).
 *
 * Two failure modes matter more than the happy path:
 *
 *   1. The config silently stops applying. A `.gitleaks.toml` with no
 *      `[extend]` block and no `[[rules]]` *replaces* gitleaks' built-in rules,
 *      so the whole scan becomes a no-op that still reports clean. The first
 *      assertions pin the extend + Stellar rules that prevent that.
 *   2. The hook script stops failing a commit. Its behaviour is exercised
 *      end-to-end against a stub `gitleaks` binary and a throwaway git repo, so
 *      a regression in the exit-status handling is caught without installing
 *      the real scanner.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_PATH = join(REPO_ROOT, ".gitleaks.toml");
const HOOK_SCRIPT = join(REPO_ROOT, "scripts", "pre-commit-secrets.sh");

const config = readFileSync(CONFIG_PATH, "utf8");

/** Extract a rule's `regex = '''…'''` body by rule id. */
function ruleRegex(id: string): string {
  const match = config.match(
    new RegExp(`id\\s*=\\s*"${id}"[\\s\\S]*?regex\\s*=\\s*'''([^']+)'''`)
  );
  if (!match) throw new Error(`rule ${id} / its regex not found in .gitleaks.toml`);
  return match[1];
}

describe("gitleaks configuration (issue #1398)", () => {
  it("extends the built-in rules instead of replacing them", () => {
    // Without this, the custom config is the *entire* rule set — and it used to
    // have none, making the CI scan a no-op.
    expect(config).toMatch(/\[extend\]/);
    expect(config).toMatch(/useDefault\s*=\s*true/);
  });

  it("defines a strict Stellar secret-seed rule", () => {
    expect(config).toMatch(/id\s*=\s*"stellar-secret-seed"/);
    expect(ruleRegex("stellar-secret-seed")).toContain("S[A-Z0-9]{55}");
  });

  it("allowlists the acknowledged test fixtures", () => {
    expect(config).toMatch(/tests\/fixtures\/secrets\//);
  });

  describe("the Stellar rule's regex", () => {
    // Built at runtime so this test file never contains a seed-shaped literal
    // that the repo-wide scan would (correctly) flag.
    const seed = `S${"A".repeat(55)}`;
    const publicKey = `G${"A".repeat(55)}`;
    const regex = new RegExp(ruleRegex("stellar-secret-seed"));

    it("matches a 56-character S-prefixed seed, even embedded in text", () => {
      expect(regex.test(seed)).toBe(true);
      expect(regex.test(`STELLAR_SECRET_KEY=${seed}`)).toBe(true);
      expect(regex.test(`export SEED='${seed}'`)).toBe(true);
    });

    it("does not match a public key, and is not tripped by ordinary text", () => {
      expect(regex.test(publicKey)).toBe(false);
      expect(regex.test("GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U")).toBe(false);
      expect(regex.test("the quick brown fox jumps over the lazy dog")).toBe(false);
      expect(regex.test("S")).toBe(false);
    });
  });
});

describe("repository wiring (issue #1398)", () => {
  it("commits a pre-commit hook that runs the scan script", () => {
    const hook = readFileSync(join(REPO_ROOT, ".githooks", "pre-commit"), "utf8");
    expect(hook).toContain("scripts/pre-commit-secrets.sh");
  });

  it("wires the hook install through `npm run prepare`", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prepare).toContain("install-git-hooks.mjs");
    expect(pkg.scripts["secrets:scan"]).toContain("gitleaks");
  });
});

describe("pre-commit hook behaviour (issue #1398)", () => {
  let workdir: string;
  let repo: string;
  let stubDir: string;
  let argsFile: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), "ophirpay-secrets-hook-"));
    repo = join(workdir, "repo");
    stubDir = join(workdir, "bin");
    argsFile = join(workdir, "args.log");
    mkdirSync(repo);
    mkdirSync(stubDir);

    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
    // The script looks for .gitleaks.toml at the (temporary) repo root.
    copyFileSync(CONFIG_PATH, join(repo, ".gitleaks.toml"));
    writeFileSync(join(repo, "staged.txt"), "a change to scan\n");
    execFileSync("git", ["-C", repo, "add", "staged.txt"]);

    // A stub `gitleaks` that records its invocation and exits with
    // $STUB_EXIT_CODE (default 0). `help` always fails so the script takes the
    // `protect --staged` path, matching the version pinned in CI.
    const stub = join(stubDir, "gitleaks");
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        `echo "$@" >> "${argsFile}"`,
        'if [ "$1" = "help" ]; then exit 1; fi',
        'exit "${STUB_EXIT_CODE:-0}"',
        "",
      ].join("\n")
    );
    chmodSync(stub, 0o755);
  });

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  function runHook(opts: { exitCode?: number; path?: string }) {
    try {
      const stdout = execFileSync("bash", [HOOK_SCRIPT], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: opts.path ?? `${stubDir}:${process.env.PATH}`,
          STUB_EXIT_CODE: String(opts.exitCode ?? 0),
        },
      });
      return { status: 0, output: stdout };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  it("fails the commit when gitleaks reports a finding", () => {
    const { status, output } = runHook({ exitCode: 1 });
    expect(status).toBe(1);
    expect(output).toMatch(/blocked/i);
  });

  it("passes the commit when gitleaks reports no findings", () => {
    const { status } = runHook({ exitCode: 0 });
    expect(status).toBe(0);
  });

  it("scans the staged changes with the repo config", () => {
    writeFileSync(argsFile, "");
    runHook({ exitCode: 1 });
    const args = readFileSync(argsFile, "utf8");
    expect(args).toContain("--staged");
    expect(args).toContain("--config .gitleaks.toml");
  });

  it("skips (exit 0) when gitleaks is not installed", () => {
    // Only meaningful when the limited PATH genuinely has no gitleaks;
    // otherwise the assertion would be environment-dependent.
    let gitleaksPresent = true;
    try {
      execFileSync("gitleaks", ["version"], {
        stdio: "ignore",
        env: { ...process.env, PATH: "/usr/bin:/bin" },
      });
    } catch {
      gitleaksPresent = false;
    }

    const { status, output } = runHook({ path: "/usr/bin:/bin" });
    if (gitleaksPresent) {
      // A machine that has gitleaks runs a real scan instead — assert the scan
      // path rather than the skip path.
      expect([0, 1]).toContain(status);
    } else {
      expect(status).toBe(0);
      expect(output).toMatch(/not installed/i);
    }
  });
});
