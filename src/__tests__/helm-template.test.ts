// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import yaml from "js-yaml";

const ROOT = process.cwd();
const envExamplePath = join(ROOT, ".env.example");
const valuesYamlPath = join(ROOT, "helm", "ophirpay", "values.yaml");
const deploymentDocPath = join(ROOT, "docs", "DEPLOYMENT.md");

interface ValuesYaml {
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}

interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
  };
  data?: Record<string, string>;
  stringData?: Record<string, string>;
}

/**
 * Extracts environment variable names from an env file content.
 * Matches both uncommented (KEY=val) and commented (# KEY=val) definitions.
 */
function extractAllowedEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^(?:#\s*)?([A-Z][A-Z0-9_]+)=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Validates whether all keys are present in the allowed keys set.
 */
function validateConfigKeys(
  keys: string[],
  allowedKeys: Set<string>
): { valid: boolean; unknownKeys: string[] } {
  const unknownKeys = keys.filter((key) => !allowedKeys.has(key));
  return {
    valid: unknownKeys.length === 0,
    unknownKeys,
  };
}

describe("Helm configuration conformance to .env.example", () => {
  const envContent = readFileSync(envExamplePath, "utf8");
  const valuesContent = readFileSync(valuesYamlPath, "utf8");
  const allowedKeys = extractAllowedEnvKeys(envContent);
  const parsedValues = yaml.load(valuesContent) as ValuesYaml;

  it("extracts valid environment variable keys from .env.example", () => {
    expect(allowedKeys.has("NEXT_PUBLIC_STELLAR_HORIZON_URL")).toBe(true);
    expect(allowedKeys.has("NEXT_PUBLIC_STELLAR_RPC_URL")).toBe(true);
    expect(allowedKeys.has("NEXT_PUBLIC_STELLAR_NETWORK")).toBe(true);
    expect(allowedKeys.has("DATABASE_PROVIDER")).toBe(true);
    expect(allowedKeys.has("NODE_ENV")).toBe(true);
    expect(allowedKeys.has("DATABASE_URL")).toBe(true);
    expect(allowedKeys.has("NEXT_PUBLIC_CONTRACT_ID")).toBe(true);
    expect(allowedKeys.has("NEXT_PUBLIC_EMITTER_CONTRACT_ID")).toBe(true);

    expect(allowedKeys.has("NEXT_PUBLIC_HORIZON_URL")).toBe(false);
    expect(allowedKeys.has("NEXT_PUBLIC_SOROBAN_RPC_URL")).toBe(false);
  });

  it("ensures all keys in helm/ophirpay/values.yaml config exist in .env.example", () => {
    const configKeys = Object.keys(parsedValues.config || {});
    expect(configKeys.length).toBeGreaterThan(0);

    const validation = validateConfigKeys(configKeys, allowedKeys);
    expect(validation.unknownKeys).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("ensures all keys in helm/ophirpay/values.yaml secrets exist in .env.example", () => {
    const secretKeys = Object.keys(parsedValues.secrets || {});
    expect(secretKeys.length).toBeGreaterThan(0);

    const validation = validateConfigKeys(secretKeys, allowedKeys);
    expect(validation.unknownKeys).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("verifies values.yaml uses aligned Stellar variable names and avoids legacy keys", () => {
    const configKeys = Object.keys(parsedValues.config || {});
    expect(configKeys).toContain("NEXT_PUBLIC_STELLAR_HORIZON_URL");
    expect(configKeys).toContain("NEXT_PUBLIC_STELLAR_RPC_URL");
    expect(configKeys).not.toContain("NEXT_PUBLIC_HORIZON_URL");
    expect(configKeys).not.toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
  });

  it("flags unknown config keys in validation logic", () => {
    const testKeys = [
      "NEXT_PUBLIC_STELLAR_NETWORK",
      "UNKNOWN_CONFIG_VARIABLE",
      "NEXT_PUBLIC_HORIZON_URL",
    ];
    const validation = validateConfigKeys(testKeys, allowedKeys);
    expect(validation.valid).toBe(false);
    expect(validation.unknownKeys).toEqual([
      "UNKNOWN_CONFIG_VARIABLE",
      "NEXT_PUBLIC_HORIZON_URL",
    ]);
  });
});

describe("Rendered helm template conformance", () => {
  const envContent = readFileSync(envExamplePath, "utf8");
  const allowedKeys = extractAllowedEnvKeys(envContent);

  let renderedDocs: K8sResource[] = [];

  try {
    const output = execSync("helm template ophirpay ./helm/ophirpay", {
      cwd: ROOT,
      encoding: "utf8",
    });
    renderedDocs = yaml.loadAll(output) as K8sResource[];
  } catch {
    renderedDocs = [];
  }

  it("renders helm template and extracts ConfigMap and Secret manifests", () => {
    expect(renderedDocs.length).toBeGreaterThan(0);
    const configMap = renderedDocs.find(
      (doc) => doc.kind === "ConfigMap" && doc.metadata?.name?.includes("config")
    );
    expect(configMap).toBeDefined();

    const secret = renderedDocs.find(
      (doc) => doc.kind === "Secret" && doc.metadata?.name?.includes("secrets")
    );
    expect(secret).toBeDefined();
  });

  it("asserts all rendered ConfigMap keys match .env.example names", () => {
    const configMap = renderedDocs.find(
      (doc) => doc.kind === "ConfigMap" && doc.metadata?.name?.includes("config")
    );
    expect(configMap?.data).toBeDefined();

    const configKeys = Object.keys(configMap?.data || {});
    expect(configKeys.length).toBeGreaterThan(0);

    const validation = validateConfigKeys(configKeys, allowedKeys);
    expect(validation.unknownKeys).toEqual([]);
    expect(validation.valid).toBe(true);

    expect(configKeys).toContain("NEXT_PUBLIC_STELLAR_HORIZON_URL");
    expect(configKeys).toContain("NEXT_PUBLIC_STELLAR_RPC_URL");
    expect(configKeys).not.toContain("NEXT_PUBLIC_HORIZON_URL");
    expect(configKeys).not.toContain("NEXT_PUBLIC_SOROBAN_RPC_URL");
  });

  it("asserts all rendered Secret keys match .env.example names", () => {
    const secret = renderedDocs.find(
      (doc) => doc.kind === "Secret" && doc.metadata?.name?.includes("secrets")
    );
    expect(secret?.stringData).toBeDefined();

    const secretKeys = Object.keys(secret?.stringData || {});
    expect(secretKeys.length).toBeGreaterThan(0);

    const validation = validateConfigKeys(secretKeys, allowedKeys);
    expect(validation.unknownKeys).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("fails template rendering when deprecated NEXT_PUBLIC_HORIZON_URL is provided", () => {
    expect(() => {
      execSync(
        "helm template ophirpay ./helm/ophirpay --set config.NEXT_PUBLIC_HORIZON_URL=https://bad.com",
        {
          cwd: ROOT,
          encoding: "utf8",
          stdio: "pipe",
        }
      );
    }).toThrow();
  });

  it("fails template rendering when deprecated NEXT_PUBLIC_SOROBAN_RPC_URL is provided", () => {
    expect(() => {
      execSync(
        "helm template ophirpay ./helm/ophirpay --set config.NEXT_PUBLIC_SOROBAN_RPC_URL=https://bad.com",
        {
          cwd: ROOT,
          encoding: "utf8",
          stdio: "pipe",
        }
      );
    }).toThrow();
  });
});

describe("Helm documentation and build-time NEXT_PUBLIC_* caveats", () => {
  it("documents build-time inlining requirement in values.yaml", () => {
    const valuesContent = readFileSync(valuesYamlPath, "utf8");
    expect(valuesContent).toContain("NEXT_PUBLIC_*");
    expect(valuesContent).toContain("build time");
  });

  it("documents build-time vs runtime consequence in docs/DEPLOYMENT.md", () => {
    const deploymentDoc = readFileSync(deploymentDocPath, "utf8");
    expect(deploymentDoc).toContain("NEXT_PUBLIC_STELLAR_HORIZON_URL");
    expect(deploymentDoc).toContain("NEXT_PUBLIC_STELLAR_RPC_URL");
    expect(deploymentDoc).not.toContain("--set config.NEXT_PUBLIC_HORIZON_URL");
    expect(deploymentDoc).not.toContain("--set config.NEXT_PUBLIC_SOROBAN_RPC_URL");
    expect(deploymentDoc).toContain("Build-Time vs Runtime Configuration");
  });
});
