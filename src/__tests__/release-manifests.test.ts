// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Release Workflow and Immutable Deployment Manifests (Issue #749)", () => {
  const root = process.cwd();

  describe("k8s/deployment.yaml", () => {
    const k8sFile = join(root, "k8s", "deployment.yaml");

    it("exists and is readable", () => {
      expect(existsSync(k8sFile)).toBe(true);
    });

    it("references an immutable semantic version tag instead of :latest", () => {
      const content = readFileSync(k8sFile, "utf8");
      expect(content).not.toMatch(/image:\s*ghcr\.io\/ophirpay\/ophirpay:latest/);
      expect(content).toMatch(/image:\s*ghcr\.io\/ophirpay\/ophirpay:v\d+\.\d+\.\d+/);
    });

    it("uses IfNotPresent image pull policy rather than Always", () => {
      const content = readFileSync(k8sFile, "utf8");
      expect(content).toMatch(/imagePullPolicy:\s*IfNotPresent/);
      expect(content).not.toMatch(/imagePullPolicy:\s*Always/);
    });
  });

  describe("helm/ophirpay/values.yaml", () => {
    const helmFile = join(root, "helm", "ophirpay", "values.yaml");

    it("exists and is readable", () => {
      expect(existsSync(helmFile)).toBe(true);
    });

    it("defaults to an immutable version tag instead of latest", () => {
      const content = readFileSync(helmFile, "utf8");
      expect(content).not.toMatch(/tag:\s*latest/);
      expect(content).toMatch(/tag:\s*"?v\d+\.\d+\.\d+"?/);
    });

    it("defaults to IfNotPresent pullPolicy", () => {
      const content = readFileSync(helmFile, "utf8");
      expect(content).toMatch(/pullPolicy:\s*IfNotPresent/);
      expect(content).not.toMatch(/pullPolicy:\s*Always/);
    });
  });

  describe(".github/workflows/release-docker-ghcr.yml", () => {
    const workflowFile = join(root, ".github", "workflows", "release-docker-ghcr.yml");

    it("exists and defines release workflow", () => {
      expect(existsSync(workflowFile)).toBe(true);
      const content = readFileSync(workflowFile, "utf8");

      // Verify triggers
      expect(content).toContain("release:");
      expect(content).toContain("tags:");
      expect(content).toContain("workflow_dispatch:");

      // Verify dry-run capability
      expect(content).toContain("description: 'Push image to GHCR (uncheck for dry-run)'");
      expect(content).toContain("type: boolean");

      // Verify multi-platform build setup
      expect(content).toContain("docker/setup-qemu-action");
      expect(content).toContain("docker/setup-buildx-action");
      expect(content).toContain("platforms: linux/amd64,linux/arm64");

      // Verify GHCR target and auth
      expect(content).toContain("registry: ghcr.io");
      expect(content).toContain("ghcr.io/ophirpay/ophirpay");
      expect(content).toContain("GITHUB_TOKEN");

      // Verify provenance and SBOM configuration
      expect(content).toContain("provenance: mode=max");
      expect(content).toContain("sbom: true");
      expect(content).toContain("actions/attest-build-provenance");
    });
  });
});
