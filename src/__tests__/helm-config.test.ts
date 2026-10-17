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

interface ChartValues {
  config: Record<string, string>;
  secrets: Record<string, string>;
}

const values = load(
  readFileSync(join(chartDir, "values.yaml"), "utf8"),
) as ChartValues;

const envExampleRaw = readFileSync(join(repoRoot, ".env.example"), "utf8");

export function parseEnvExampleVars(envText: string): {
  requiredEnvVars: Set<string>;
  optionalEnvVars: Set<string>;
  documentedEnvVars: Set<string>;
} {
  const requiredEnvVars = new Set(
    Array.from(envText.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm), (m) => m[1]),
  );
  const allEnvVars = new Set(
    Array.from(envText.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm), (m) => m[1]),
  );
  const optionalEnvVars = new Set(
    Array.from(allEnvVars).filter((k) => !requiredEnvVars.has(k)),
  );
  return {
    requiredEnvVars,
    optionalEnvVars,
    documentedEnvVars: allEnvVars,
  };
}

export function validateHelmEnvParity(
  chartValues: ChartValues,
  envText: string = envExampleRaw,
): {
  valid: boolean;
  undocumentedKeys: string[];
  missingRequiredKeys: string[];
} {
  const { requiredEnvVars, documentedEnvVars } = parseEnvExampleVars(envText);
  const helmKeys = new Set([
    ...Object.keys(chartValues.config),
    ...Object.keys(chartValues.secrets),
  ]);

  const undocumentedKeys = Array.from(helmKeys).filter(
    (key) => !documentedEnvVars.has(key),
  );
  const missingRequiredKeys = Array.from(requiredEnvVars).filter(
    (key) => !helmKeys.has(key),
  );

  return {
    valid: undocumentedKeys.length === 0 && missingRequiredKeys.length === 0,
    undocumentedKeys,
    missingRequiredKeys,
  };
}

/**
 * Every variable name documented in `.env.example`, including the
 * commented-out optional/mainnet entries (they are still part of the
 * documented surface, e.g. `REDIS_URL`).
 */
const { requiredEnvVars, optionalEnvVars, documentedEnvVars } =
  parseEnvExampleVars(envExampleRaw);

function chartFiles(dir: string): { path: string; contents: string }[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? chartFiles(full)
      : [{ path: full, contents: readFileSync(full, "utf8") }];
  });
}

describe(".env.example parsing", () => {
  it("collects documented variables, distinguishing required and optional (#1336)", () => {
    expect(documentedEnvVars.has("DATABASE_URL")).toBe(true);
    expect(requiredEnvVars.has("DATABASE_URL")).toBe(true);
    expect(documentedEnvVars.has("NEXT_PUBLIC_STELLAR_RPC_URL")).toBe(true);
    // Present as commented-out optional variables in .env.example:
    expect(optionalEnvVars.has("REDIS_URL")).toBe(true);
    expect(optionalEnvVars.has("METRICS_TOKEN")).toBe(true);
    expect(optionalEnvVars.has("CRON_SECRET")).toBe(true);
  });
});

describe("helm/ophirpay config keys (#683, #1336)", () => {
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

  it("allows configuring optional .env.example keys METRICS_TOKEN, CRON_SECRET, and REDIS_URL (#1336)", () => {
    expect(values.secrets).toHaveProperty("METRICS_TOKEN");
    expect(values.secrets).toHaveProperty("CRON_SECRET");
    expect(values.secrets).toHaveProperty("REDIS_URL");
    expect(values.secrets).toHaveProperty("REDIS_TOKEN");
    expect(values.secrets).toHaveProperty("SCHEDULED_PAYMENTS_SOURCE_SECRET");

    const parity = validateHelmEnvParity({
      config: { ...values.config },
      secrets: {
        ...values.secrets,
        METRICS_TOKEN: "prom-scrape-token",
        CRON_SECRET: "cron-secret-value",
        REDIS_URL: "redis://redis:6379",
      },
    });
    expect(parity.valid).toBe(true);
    expect(parity.undocumentedKeys).toEqual([]);
    expect(parity.missingRequiredKeys).toEqual([]);
  });

  it("fails parity when an undocumented key is added or a required key is missing (#1336)", () => {
    const withTypo = validateHelmEnvParity({
      config: {
        ...values.config,
        NEXT_PUBLIC_TYPO_RPC_URL: "https://invalid.example",
      },
      secrets: { ...values.secrets },
    });
    expect(withTypo.valid).toBe(false);
    expect(withTypo.undocumentedKeys).toEqual(["NEXT_PUBLIC_TYPO_RPC_URL"]);

    const withoutDatabaseUrl = { ...values.secrets };
    delete withoutDatabaseUrl.DATABASE_URL;
    const missingRequired = validateHelmEnvParity({
      config: { ...values.config },
      secrets: withoutDatabaseUrl,
    });
    expect(missingRequired.valid).toBe(false);
    expect(missingRequired.missingRequiredKeys).toContain("DATABASE_URL");
  });

  it("conditionally renders only non-empty entries in templates/config.yaml (#1336)", () => {
    const configTemplate = readFileSync(
      join(templatesDir, "config.yaml"),
      "utf8",
    );
    expect(configTemplate).toContain('{{- if ne ($val | toString) "" }}');
  });

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
