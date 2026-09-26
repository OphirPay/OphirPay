// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #725 — a contributor on the wrong Node major used to get a wall of
 * confusing failures from Next 16 / Prisma 6 / Tailwind v4 native binaries
 * instead of one actionable message.
 *
 * The preflight itself is covered as pure logic (so the test does not depend on
 * which Node happens to run the suite), and the acceptance criterion
 * "`.nvmrc`, `engines.node` and the CI `node-version-file` all agree" is
 * enforced as a drift guard across every workflow.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

type PreflightModule = {
  majorOf: (version: unknown) => number | null;
  parsePackageManager: (value: unknown) => { name: string; version: string } | null;
  npmVersionFromUserAgent: (userAgent: unknown) => string | null;
  evaluate: (input: { expectedVersion: unknown; actualVersion: unknown }) => {
    ok: boolean;
    expected: number | null;
    actual: number | null;
  };
  readRequirements: (root?: string) => {
    nvmrc: string;
    enginesNode: string | null;
    packageManager: { name: string; version: string } | null;
  };
  describeRequirements: (req: {
    nvmrc: string;
    enginesNode: string | null;
    packageManager: { name: string; version: string } | null;
  }) => string;
};

let preflight: PreflightModule;

beforeAll(async () => {
  preflight = (await import("../../scripts/check-node.mjs")) as unknown as PreflightModule;
});

describe("scripts/check-node.mjs — pure preflight logic", () => {
  it("reads the major version from every shape of pin", () => {
    expect(preflight.majorOf("v20.11.1")).toBe(20);
    expect(preflight.majorOf("20")).toBe(20);
    expect(preflight.majorOf("20.x")).toBe(20);
    expect(preflight.majorOf(">=20.9.0")).toBe(20);
    expect(preflight.majorOf("")).toBeNull();
    expect(preflight.majorOf(null)).toBeNull();
  });

  it("parses the packageManager field and ignores malformed values", () => {
    expect(preflight.parsePackageManager("npm@10.8.2")).toEqual({
      name: "npm",
      version: "10.8.2",
    });
    expect(preflight.parsePackageManager("pnpm@9.0.0")).toEqual({
      name: "pnpm",
      version: "9.0.0",
    });
    expect(preflight.parsePackageManager("")).toBeNull();
    expect(preflight.parsePackageManager(undefined)).toBeNull();
  });

  it("extracts the npm version from npm's own user agent", () => {
    expect(
      preflight.npmVersionFromUserAgent(
        "npm/10.8.2 node/v20.11.1 linux x64 workspaces/false"
      )
    ).toBe("10.8.2");
    expect(preflight.npmVersionFromUserAgent("yarn/1.22.19 npm/?")).toBeNull();
    expect(preflight.npmVersionFromUserAgent(undefined)).toBeNull();
  });

  it("accepts the pinned major and rejects any other", () => {
    expect(preflight.evaluate({ expectedVersion: "20", actualVersion: "20.11.1" })).toEqual({
      ok: true,
      expected: 20,
      actual: 20,
    });
    expect(preflight.evaluate({ expectedVersion: "20", actualVersion: "24.14.0" })).toEqual({
      ok: false,
      expected: 20,
      actual: 24,
    });
    expect(preflight.evaluate({ expectedVersion: "", actualVersion: "24.14.0" }).ok).toBe(false);
  });

  it("reports the pinned toolchain in its failure message", () => {
    const requirements = preflight.readRequirements(ROOT);
    const described = preflight.describeRequirements(requirements);
    expect(described).toContain(".nvmrc");
    expect(described).toContain("engines.node");
    expect(described).toContain("packageManager");
  });

  it("is wired into installs via the preinstall hook", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.preinstall).toBe("node scripts/check-node.mjs");
  });
});

describe("Node version agreement (.nvmrc · engines.node · CI)", () => {
  const requirements = () => preflight.readRequirements(ROOT);

  it(".nvmrc and engines.node pin the same major", () => {
    const { nvmrc, enginesNode } = requirements();
    expect(enginesNode).toBeTruthy();
    expect(preflight.majorOf(enginesNode)).toBe(preflight.majorOf(nvmrc));
    expect(preflight.majorOf(nvmrc)).toBe(20);
  });

  it("packageManager pins the npm major that ships with that Node line", () => {
    const { packageManager } = requirements();
    expect(packageManager?.name).toBe("npm");
    expect(packageManager?.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("every workflow that sets up Node reads the version from .nvmrc", () => {
    const dir = path.join(ROOT, ".github", "workflows");
    const workflows = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    expect(workflows.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of workflows) {
      const source = readFileSync(path.join(dir, file), "utf8");
      if (!source.includes("actions/setup-node@")) continue;
      // A hard-coded `node-version: 20` would drift from .nvmrc the moment the
      // pin is bumped, so every setup-node step must use node-version-file.
      const steps = source.split(/actions\/setup-node@/).slice(1);
      for (const step of steps) {
        const block = step.slice(0, 200);
        if (!/node-version-file:\s*['"]?\.nvmrc/.test(block)) {
          offenders.push(file);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("CONTRIBUTING documents the supported version and the preflight", () => {
    const doc = read("CONTRIBUTING.md");
    expect(doc).toMatch(/Node\.js 20|Node 20/);
    expect(doc).toContain(".nvmrc");
    expect(doc).toContain("scripts/check-node.mjs");
    expect(doc).toContain("preinstall");
  });

  it("the Docker build runs the same preflight as local installs", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("COPY scripts/check-node.mjs");
  });
});
