// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Issue #1300 — Multi-architecture Docker builds (linux/amd64 + linux/arm64)
 * Validates CI workflow definitions, QEMU configuration, platform-agnostic
 * Dockerfile/Compose setups, and deployment documentation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("CI Docker smoke test multi-arch workflow (issue #1300)", () => {
  const workflowPath = ".github/workflows/docker-smoke.yml";
  const content = read(workflowPath);
  const parsed = load(content) as {
    jobs: {
      "docker-smoke": {
        strategy?: {
          matrix?: {
            include?: Array<{ arch: string; platform: string }>;
          };
        };
        steps: Array<{
          name?: string;
          uses?: string;
          with?: Record<string, unknown>;
          run?: string;
        }>;
      };
      "docker-manifest"?: {
        steps: Array<{
          name?: string;
          uses?: string;
          with?: Record<string, unknown>;
        }>;
      };
    };
  };

  it("configures QEMU cross-compilation with linux/amd64 and linux/arm64 platforms", () => {
    const qemuStep = parsed.jobs["docker-smoke"].steps.find((s) =>
      s.uses?.startsWith("docker/setup-qemu-action")
    );
    expect(qemuStep, "docker/setup-qemu-action step missing").toBeTruthy();
    expect(qemuStep?.with?.platforms).toBe("linux/amd64,linux/arm64");
  });

  it("defines a parallel strategy matrix for both amd64 and arm64", () => {
    const matrix = parsed.jobs["docker-smoke"].strategy?.matrix?.include;
    expect(matrix).toBeDefined();
    expect(matrix).toHaveLength(2);

    const platforms = matrix!.map((m) => m.platform);
    expect(platforms).toContain("linux/amd64");
    expect(platforms).toContain("linux/arm64");

    const arches = matrix!.map((m) => m.arch);
    expect(arches).toContain("amd64");
    expect(arches).toContain("arm64");
  });

  it("runs container startup smoke test and healthcheck on both architectures", () => {
    const steps = parsed.jobs["docker-smoke"].steps;
    const smokeStep = steps.find((s) => s.run?.includes("docker run -d --rm --name app-smoke-"));
    expect(smokeStep, "smoke test container step missing matrix.arch").toBeTruthy();
    expect(smokeStep?.run).toContain("${{ matrix.arch }}");
    expect(smokeStep?.run).toContain("/api/health");

    const healthcheckStep = steps.find((s) => s.run?.includes("docker inspect"));
    expect(healthcheckStep, "docker inspect step missing matrix.arch").toBeTruthy();
    expect(healthcheckStep?.run).toContain("${{ matrix.arch }}");
    expect(healthcheckStep?.run).toContain("app-smoke-${{ matrix.arch }}");
  });

  it("validates multi-arch image manifest generation across linux/amd64 and linux/arm64", () => {
    const manifestJob = parsed.jobs["docker-manifest"];
    expect(manifestJob, "docker-manifest job missing").toBeTruthy();

    const buildStep = manifestJob?.steps.find((s) =>
      s.uses?.startsWith("docker/build-push-action")
    );
    expect(buildStep, "manifest build step missing").toBeTruthy();
    expect(buildStep?.with?.platforms).toBe("linux/amd64,linux/arm64");
  });
});

describe("Dockerfile platform compatibility (issue #1300)", () => {
  const dockerfile = read("Dockerfile");

  it("uses official multi-arch node:24-slim base without hardcoded platform", () => {
    const fromLines = dockerfile.split("\n").filter((l) => l.trim().startsWith("FROM"));
    expect(fromLines.length).toBeGreaterThanOrEqual(3);
    for (const fromLine of fromLines) {
      expect(fromLine).toContain("node:24-slim");
      expect(fromLine).not.toMatch(/--platform=linux\/(amd64|arm64)/);
    }
  });

  it("copies Prisma binary engine with architecture-flexible pattern", () => {
    expect(dockerfile).toContain(".prisma/client/*.node");
  });
});

describe("docker-compose platform neutrality (issue #1300)", () => {
  const compose = load(read("docker-compose.yml")) as {
    services: Record<string, Record<string, unknown>>;
  };

  it("contains no platform-specific overrides", () => {
    for (const [serviceName, service] of Object.entries(compose.services)) {
      expect(service.platform, `Service ${serviceName} should not lock platform`).toBeUndefined();
    }
  });
});

describe("Deployment documentation (issue #1300)", () => {
  const doc = read("docs/DEPLOYMENT.md");

  it("documents multi-architecture support and explains both platforms", () => {
    expect(doc).toContain("Multi-Architecture Builds (linux/amd64 & linux/arm64)");
    expect(doc).toContain("linux/amd64");
    expect(doc).toContain("linux/arm64");
    expect(doc).toContain("Apple Silicon");
  });

  it("documents and justifies build time increase under QEMU emulation", () => {
    expect(doc).toMatch(/Build Time Increase Justification/i);
    expect(doc).toMatch(/QEMU emulation/i);
    expect(doc).toMatch(/Matrix Parallelization/i);
    expect(doc).toMatch(/BuildKit Layer Caching/i);
  });
});
