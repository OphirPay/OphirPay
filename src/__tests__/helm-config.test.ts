// SPDX-License-Identifier: MIT

/**
 * Issue #683 — Helm values must use the configuration names the app reads.
 *
 * `helm/ophirpay/values.yaml` shipped `NEXT_PUBLIC_HORIZON_URL` and
 * `NEXT_PUBLIC_SOROBAN_RPC_URL`, while the app and `.env.example` use
 * `NEXT_PUBLIC_STELLAR_HORIZON_URL` and `NEXT_PUBLIC_STELLAR_RPC_URL`.
 * Rendering the chart therefore produced a ConfigMap nobody consulted and an
 * operator who "configured mainnet in Helm" silently stayed on testnet.
 *
 * These tests fail when a chart config/secret key is not a documented
 * `.env.example` variable, which is the guard against that class of typo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const repoRoot = process.cwd();
const chartDir = join(repoRoot, "helm", "ophirpay");
const templatesDir = join(chartDir, "templates");

interface ProbeConfig {
  httpGet: { path: string; port: number };
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
}

interface ChartValues {
  config: Record<string, string>;
  secrets: Record<string, string>;
  livenessProbe: ProbeConfig;
  readinessProbe: ProbeConfig;
}

const values = load(
  readFileSync(join(chartDir, "values.yaml"), "utf8"),
) as ChartValues;

/**
 * Every variable name documented in `.env.example`, including the
 * commented-out optional/mainnet entries (they are still part of the
 * documented surface, e.g. `REDIS_URL`).
 */
const documentedEnvVars = new Set(
  Array.from(
    readFileSync(join(repoRoot, ".env.example"), "utf8").matchAll(
      /^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm,
    ),
    (match) => match[1],
  ),
);

function chartFiles(dir: string): { path: string; contents: string }[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? chartFiles(full)
      : [{ path: full, contents: readFileSync(full, "utf8") }];
  });
}

describe(".env.example parsing", () => {
  it("collects documented variables, commented or not", () => {
    expect(documentedEnvVars.has("DATABASE_URL")).toBe(true);
    expect(documentedEnvVars.has("NEXT_PUBLIC_STELLAR_RPC_URL")).toBe(true);
    // Only present as a commented-out optional variable.
    expect(documentedEnvVars.has("REDIS_URL")).toBe(true);
  });
});

describe("helm/ophirpay config keys (#683)", () => {
  it.each(Object.keys(values.config))(
    "config key %s is a documented .env.example variable",
    (key) => {
      expect(documentedEnvVars.has(key)).toBe(true);
    },
  );

  it.each(Object.keys(values.secrets))(
    "secret key %s is a documented .env.example variable",
    (key) => {
      expect(documentedEnvVars.has(key)).toBe(true);
    },
  );

  it.each([...Object.keys(values.config), ...Object.keys(values.secrets)])(
    "key %s is a valid environment variable name",
    (key) => {
      expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
    },
  );

  it("uses the Stellar variable names the application reads", () => {
    const envSchema = readFileSync(
      join(repoRoot, "src", "lib", "env.ts"),
      "utf8",
    );

    for (const key of [
      "NEXT_PUBLIC_STELLAR_HORIZON_URL",
      "NEXT_PUBLIC_STELLAR_RPC_URL",
    ]) {
      expect(values.config).toHaveProperty(key);
      expect(envSchema).toContain(key);
    }
  });

  it("does not use the legacy misspelled keys anywhere in the manifests", () => {
    const legacyKeys = ["NEXT_PUBLIC_HORIZON_URL", "NEXT_PUBLIC_SOROBAN_RPC_URL"];
    const files = [...chartFiles(chartDir), ...chartFiles(join(repoRoot, "k8s"))];

    for (const key of legacyKeys) {
      const offenders = files
        .filter((file) => file.contents.includes(key))
        .map((file) => file.path.replace(`${repoRoot}/`, ""));

      expect(offenders, `${key} must not appear in the manifests`).toEqual([]);
    }
  });

  it("documents that NEXT_PUBLIC_* must be provided at build time", () => {
    // Acceptance criteria for #683: the chart itself has to explain the
    // Next.js build-time inlining consequence, not just the repo docs.
    const notes = readFileSync(join(templatesDir, "NOTES.txt"), "utf8");
    const rawValues = readFileSync(join(chartDir, "values.yaml"), "utf8");

    expect(notes).toMatch(/BUILD-TIME/i);
    expect(notes).toMatch(/NEXT_PUBLIC_/);
    expect(rawValues).toMatch(/build\*?\*? time/i);
  });
});

describe("Kubernetes and Helm probe configuration (#1426)", () => {
  it("configures liveness probe with tuned delay, period, timeout, and failure threshold", () => {
    expect(values.livenessProbe.initialDelaySeconds).toBe(30);
    expect(values.livenessProbe.periodSeconds).toBe(10);
    expect(values.livenessProbe.timeoutSeconds).toBe(5);
    expect(values.livenessProbe.failureThreshold).toBe(3);
    expect(values.livenessProbe.httpGet.path).toBe("/api/health/live");
  });

  it("configures readiness probe with tuned delay, period, timeout, and failure threshold", () => {
    expect(values.readinessProbe.initialDelaySeconds).toBe(15);
    expect(values.readinessProbe.periodSeconds).toBe(10);
    expect(values.readinessProbe.timeoutSeconds).toBe(5);
    expect(values.readinessProbe.failureThreshold).toBe(3);
    expect(values.readinessProbe.httpGet.path).toBe("/api/health");
  });

  it("matches probe settings in raw k8s deployment manifest", () => {
    const deploymentManifest = readFileSync(
      join(repoRoot, "k8s", "deployment.yaml"),
      "utf8",
    );
    expect(deploymentManifest).toContain("path: /api/health/live");
    expect(deploymentManifest).toContain("path: /api/health");
    expect(deploymentManifest).toMatch(
      /livenessProbe:[\s\S]*?initialDelaySeconds:\s*30[\s\S]*?periodSeconds:\s*10[\s\S]*?timeoutSeconds:\s*5[\s\S]*?failureThreshold:\s*3/,
    );
    expect(deploymentManifest).toMatch(
      /readinessProbe:[\s\S]*?initialDelaySeconds:\s*15[\s\S]*?periodSeconds:\s*10[\s\S]*?timeoutSeconds:\s*5[\s\S]*?failureThreshold:\s*3/,
    );
  });
});
