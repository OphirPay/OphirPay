// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeHelmConfigChecksum,
  verifyHelmDeploymentChecksumAnnotation,
} from "../../scripts/verify-helm-checksum.mjs";

const DEPLOYMENT_PATH = path.resolve(
  process.cwd(),
  "helm/ophirpay/templates/deployment.yaml"
);

describe("Helm pod template checksum annotation (#1332)", () => {
  it("includes checksum/config sha256sum annotation in deployment pod template", () => {
    const content = fs.readFileSync(DEPLOYMENT_PATH, "utf8");
    expect(content).toContain(
      'checksum/config: {{ include (print $.Template.BasePath "/config.yaml") . | sha256sum }}'
    );
  });

  it("changes the pod template checksum whenever config or secrets values change", () => {
    const result = verifyHelmDeploymentChecksumAnnotation();
    expect(result.baseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.changedConfigHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.changedSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.changedConfigHash).not.toBe(result.baseHash);
    expect(result.changedSecretHash).not.toBe(result.baseHash);
    expect(result.changedConfigHash).not.toBe(result.changedSecretHash);
  });

  it("produces identical checksums for identical values", () => {
    const h1 = computeHelmConfigChecksum({ config: { RATE_LIMIT_RPM: "180" } });
    const h2 = computeHelmConfigChecksum({ config: { RATE_LIMIT_RPM: "180" } });
    expect(h1).toBe(h2);
  });
});
