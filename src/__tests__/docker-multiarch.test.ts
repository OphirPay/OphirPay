// SPDX-License-Identifier: MIT
//
// Multi-architecture Docker build verification tests (issue #1300).
//
// Verifies that:
// 1. .github/workflows/docker-smoke.yml configures QEMU, Buildx, and tests both
//    linux/amd64 and linux/arm64 in CI.
// 2. Both architectures run container startup health checks.
// 3. Multi-arch manifests are generated for linux/amd64 and linux/arm64.
// 4. docker-compose.yml remains platform-agnostic.
// 5. Dockerfile and Prisma schema include multi-arch binary targets.
// 6. Build time increase and architectural trade-offs are documented.

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (relPath: string): string => readFileSync(join(root, relPath), "utf8");

describe("Multi-architecture Docker build in CI (issue #1300)", () => {
  const workflowPath = ".github/workflows/docker-smoke.yml";
  const rawWorkflow = read(workflowPath);
  const workflow = load(rawWorkflow) as Record<string, any>;

  it("exists and is valid YAML", () => {
    expect(existsSync(join(root, workflowPath))).toBe(true);
    expect(workflow).toBeDefined();
    expect(workflow.jobs).toBeDefined();
  });

  it("configures QEMU cross-compilation in the smoke job", () => {
    const smokeJob = workflow.jobs["docker-smoke"];
    expect(smokeJob).toBeDefined();

    const steps = smokeJob.steps as Array<{ uses?: string; name?: string; with?: Record<string, any> }>;
    const qemuStep = steps.find((s) => s.uses && s.uses.includes("docker/setup-qemu-action"));
    expect(qemuStep, "must include docker/setup-qemu-action").toBeDefined();
    expect(qemuStep?.with?.platforms).toMatch(/arm64/);
  });

  it("configures Docker Buildx in the smoke job", () => {
    const smokeJob = workflow.jobs["docker-smoke"];
    const steps = smokeJob.steps as Array<{ uses?: string }>;
    const buildxStep = steps.find((s) => s.uses && s.uses.includes("docker/setup-buildx-action"));
    expect(buildxStep, "must include docker/setup-buildx-action").toBeDefined();
  });

  it("runs smoke testing across both linux/amd64 and linux/arm64 matrix", () => {
    const smokeJob = workflow.jobs["docker-smoke"];
    expect(smokeJob.strategy?.matrix?.include).toBeDefined();

    const matrixEntries = smokeJob.strategy.matrix.include as Array<{ platform: string; arch: string }>;
    const platforms = matrixEntries.map((e) => e.platform);
    expect(platforms).toContain("linux/amd64");
    expect(platforms).toContain("linux/arm64");
  });

  it("verifies container startup health checks for both architectures", () => {
    const smokeJob = workflow.jobs["docker-smoke"];
    const steps = smokeJob.steps as Array<{ name?: string; run?: string }>;

    const smokeStep = steps.find((s) => s.name?.includes("Smoke test the container"));
    expect(smokeStep?.run).toBeDefined();
    expect(smokeStep?.run).toContain("--platform ${{ matrix.platform }}");
    expect(smokeStep?.run).toContain("/api/health");

    const healthStep = steps.find((s) => s.name?.includes("Verify the image's HEALTHCHECK"));
    expect(healthStep?.run).toBeDefined();
    expect(healthStep?.run).toContain("docker inspect");
    expect(healthStep?.run).toContain("healthy");
  });

  it("produces multi-arch Docker manifests for linux/amd64 and linux/arm64", () => {
    const manifestJob = workflow.jobs["docker-multiarch-manifest"];
    expect(manifestJob, "manifest job must be defined").toBeDefined();

    const steps = manifestJob.steps as Array<{ uses?: string; with?: Record<string, any> }>;
    const buildStep = steps.find((s) => s.uses && s.uses.includes("docker/build-push-action"));
    expect(buildStep).toBeDefined();
    expect(buildStep?.with?.platforms).toContain("linux/amd64");
    expect(buildStep?.with?.platforms).toContain("linux/arm64");
  });
});

describe("docker-compose.yml platform-agnostic verification (issue #1300)", () => {
  const composePath = "docker-compose.yml";
  const rawCompose = read(composePath);
  const compose = load(rawCompose) as Record<string, any>;

  it("does not hardcode platform directives in services", () => {
    expect(rawCompose).not.toMatch(/^\s*platform:\s*linux\/amd64/m);
    for (const [serviceName, serviceConfig] of Object.entries<any>(compose.services || {})) {
      expect(
        serviceConfig.platform,
        `service ${serviceName} should not pin a specific platform`
      ).toBeUndefined();
    }
  });

  it("uses multi-arch backing services", () => {
    expect(compose.services.db.image).toContain("postgres:16-alpine");
    expect(compose.services.redis.image).toContain("redis:7-alpine");
  });
});

describe("Dockerfile and schema.prisma multi-architecture compatibility (issue #1300)", () => {
  it("includes linux-arm64-openssl-3.0.x in Prisma schema binaryTargets", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toContain('"debian-openssl-3.0.x"');
    expect(schema).toContain('"linux-arm64-openssl-3.0.x"');
  });

  it("copies engine *.node files without architecture pinning in Dockerfile", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("node_modules/.prisma/client/*.node");
  });
});

describe("Documentation and build time increase justification (issue #1300)", () => {
  it("documents multi-architecture builds in docs/DEPLOYMENT.md", () => {
    const deployment = read("docs/DEPLOYMENT.md");
    expect(deployment).toContain("Multi-Architecture Builds");
    expect(deployment).toContain("linux/amd64");
    expect(deployment).toContain("linux/arm64");
  });

  it("documents and justifies CI build time increase under emulation", () => {
    const deployment = read("docs/DEPLOYMENT.md");
    expect(deployment).toMatch(/Build Time Increase & Justification/i);
    expect(deployment).toMatch(/QEMU emulation/i);
    expect(deployment).toMatch(/Runtime Performance/i);
  });
});
