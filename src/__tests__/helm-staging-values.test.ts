// SPDX-License-Identifier: MIT
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STAGING_VALUES_PATH = path.resolve(
  process.cwd(),
  "helm/ophirpay/values-staging.yaml"
);
const PROD_VALUES_PATH = path.resolve(
  process.cwd(),
  "helm/ophirpay/values-production.yaml"
);

describe("Helm staging and production values files (#1330)", () => {
  const stagingYaml = fs.readFileSync(STAGING_VALUES_PATH, "utf8");
  const prodYaml = fs.readFileSync(PROD_VALUES_PATH, "utf8");

  it("configures values-staging.yaml with staging host, letsencrypt-staging issuer, single replica, and TESTNET", () => {
    expect(stagingYaml).toContain("replicaCount: 1");
    expect(stagingYaml).toContain(
      "cert-manager.io/cluster-issuer: letsencrypt-staging"
    );
    expect(stagingYaml).toContain("host: staging.ophirpay.com");
    expect(stagingYaml).toContain("secretName: ophirpay-staging-tls");
    expect(stagingYaml).toContain('NEXT_PUBLIC_STELLAR_NETWORK: "TESTNET"');
    expect(stagingYaml).toContain(
      'NEXT_PUBLIC_APP_URL: "https://staging.ophirpay.com"'
    );
    expect(stagingYaml).not.toContain("letsencrypt-prod");
  });

  it("configures values-production.yaml with production host, letsencrypt-prod issuer, HA replicas, and PUBLIC network", () => {
    expect(prodYaml).toContain("replicaCount: 2");
    expect(prodYaml).toContain(
      "cert-manager.io/cluster-issuer: letsencrypt-prod"
    );
    expect(prodYaml).toContain("host: ophirpay.com");
    expect(prodYaml).toContain("secretName: ophirpay-tls");
    expect(prodYaml).toContain('NEXT_PUBLIC_STELLAR_NETWORK: "PUBLIC"');
    expect(prodYaml).toContain('NEXT_PUBLIC_APP_URL: "https://ophirpay.com"');
  });

  it("allocates smaller CPU and memory resources in staging than in production", () => {
    expect(stagingYaml).toContain("cpu: 100m");
    expect(stagingYaml).toContain("memory: 128Mi");
    expect(prodYaml).toContain("cpu: 250m");
    expect(prodYaml).toContain("memory: 256Mi");
  });
});
