// SPDX-License-Identifier: MIT

import fs from "node:fs";
import path from "node:path";

import { describe, expect,it } from "vitest";

describe("Docker Multi-Stage Build & Image Optimization (Issue #2026)", () => {
  const dockerfilePath = path.resolve(__dirname, "../../Dockerfile");
  const dockerignorePath = path.resolve(__dirname, "../../.dockerignore");

  it("includes npm prune --production in builder stage", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");
    expect(dockerfile).toMatch(/npm\s+prune\s+--production/);
  });

  it("configures non-root nextjs user and nodejs group (1001) for runtime security", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");
    expect(dockerfile).toContain("addgroup --system --gid 1001 nodejs");
    expect(dockerfile).toContain("adduser --system --uid 1001 nextjs");
    expect(dockerfile).toContain("USER nextjs");
  });

  it("ensures all runner assets are owned by nextjs:nodejs", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");
    const runnerSection = dockerfile.split("FROM node:24-slim AS runner")[1];
    expect(runnerSection).toBeDefined();

    const chownMatches = runnerSection.match(/--chown=\S+/g) || [];
    expect(chownMatches.length).toBeGreaterThanOrEqual(5);
    for (const match of chownMatches) {
      expect(match).toBe("--chown=nextjs:nodejs");
    }
  });

  it("configures container healthcheck probe script in runner stage", () => {
    const dockerfile = fs.readFileSync(dockerfilePath, "utf-8");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("scripts/healthcheck.js");
  });

  it("excludes devDependencies, tests, logs, and artifacts in .dockerignore", () => {
    const dockerignore = fs.readFileSync(dockerignorePath, "utf-8");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".next");
    expect(dockerignore).toContain(".git");
    expect(dockerignore).toContain("contracts/**/target/");
    expect(dockerignore).toContain("e2e");
    expect(dockerignore).toContain("tests");
    expect(dockerignore).toContain("*.log");
  });
});
