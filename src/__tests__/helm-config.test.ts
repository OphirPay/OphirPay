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

const envExampleContents = readFileSync(join(repoRoot, ".env.example"), "utf8");

/**
 * Every variable name documented in `.env.example`, including the
 * commented-out optional/mainnet entries (they are still part of the
 * documented surface, e.g. `REDIS_URL`).
 */
const documentedEnvVars = new Set(
  Array.from(
    envExampleContents.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm),
    (match) => match[1],
  ),
);

/**
 * Required variables (uncommented `KEY=` lines in `.env.example`).
 * Every required variable must be rendered by the chart.
 */
const requiredEnvVars = new Set(
  Array.from(
    envExampleContents.matchAll(/^([A-Z][A-Z0-9_]*)=/gm),
    (match) => match[1],
  ),
);

/**
 * Optional variables (documented only as commented `# KEY=` lines in `.env.example`).
 */
const optionalEnvVars = new Set(
  Array.from(documentedEnvVars).filter((key) => !requiredEnvVars.has(key)),
);

const configTemplate = readFileSync(join(templatesDir, "config.yaml"), "utf8");

/**
 * Simulates the `templates/config.yaml` rendering + CI parity check for a
 * given ChartValues object against required and documented `.env.example` sets.
 */
function renderAndCheckParity(
  chartValues: ChartValues,
  required: ReadonlySet<string> = requiredEnvVars,
  documented: ReadonlySet<string> = documentedEnvVars,
  optional: ReadonlySet<string> = optionalEnvVars,
): { renderedKeys: Set<string>; missingRequired: string[]; unknownKeys: string[] } {
  const renderedKeys = new Set<string>();

  for (const [key, val] of [
    ...Object.entries(chartValues.config),
    ...Object.entries(chartValues.secrets),
  ]) {
    if (String(val) !== "" || !optional.has(key)) {
      renderedKeys.add(key);
    }
  }

  const missingRequired = Array.from(required).filter(
    (key) => !renderedKeys.has(key),
  );
  const unknownKeys = Array.from(renderedKeys).filter(
    (key) => !documented.has(key),
  );

  return { renderedKeys, missingRequired, unknownKeys };
}

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

  it("distinguishes required uncommented keys from optional commented keys (#1336)", () => {
    expect(requiredEnvVars.has("DATABASE_URL")).toBe(true);
    expect(requiredEnvVars.has("AUTH_SECRET")).toBe(true);
    expect(requiredEnvVars.has("METRICS_TOKEN")).toBe(false);
    expect(optionalEnvVars.has("METRICS_TOKEN")).toBe(true);
    expect(optionalEnvVars.has("CRON_SECRET")).toBe(true);
    expect(optionalEnvVars.has("REDIS_URL")).toBe(true);
    expect(optionalEnvVars.has("REDIS_TOKEN")).toBe(true);
    expect(optionalEnvVars.has("SCHEDULED_PAYMENTS_SOURCE_SECRET")).toBe(true);
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

  it.each(Array.from(requiredEnvVars))(
    "required .env.example variable %s is present in the chart",
    (key) => {
      const allKeys = new Set([
        ...Object.keys(values.config),
        ...Object.keys(values.secrets),
      ]);
      expect(allKeys.has(key)).toBe(true);
    },
  );

  it("exposes METRICS_TOKEN, CRON_SECRET, REDIS_URL, REDIS_TOKEN and SCHEDULED_PAYMENTS_SOURCE_SECRET with empty defaults (#1336)", () => {
    const allEntries = { ...values.config, ...values.secrets };
    for (const key of [
      "METRICS_TOKEN",
      "CRON_SECRET",
      "REDIS_URL",
      "REDIS_TOKEN",
      "SCHEDULED_PAYMENTS_SOURCE_SECRET",
    ]) {
      expect(allEntries).toHaveProperty(key, "");
    }
  });

  it("skips rendering empty optional keys in templates/config.yaml while rendering set ones (#1336)", () => {
    for (const key of [
      "METRICS_TOKEN",
      "CRON_SECRET",
      "REDIS_URL",
      "REDIS_TOKEN",
      "SCHEDULED_PAYMENTS_SOURCE_SECRET",
    ]) {
      expect(configTemplate).toContain(`"${key}" true`);
    }
    expect(configTemplate).toContain(
      "{{- if or (ne (toString $val) \"\") (not (hasKey $optional $key)) }}",
    );

    // Default values: optional keys are empty and skipped; all required keys render.
    const defaultResult = renderAndCheckParity(values);
    expect(defaultResult.missingRequired).toEqual([]);
    expect(defaultResult.unknownKeys).toEqual([]);
    expect(defaultResult.renderedKeys.has("METRICS_TOKEN")).toBe(false);
    expect(defaultResult.renderedKeys.has("CRON_SECRET")).toBe(false);
    expect(defaultResult.renderedKeys.has("REDIS_URL")).toBe(false);
    expect(defaultResult.renderedKeys.has("DATABASE_URL")).toBe(true);

    // Setting METRICS_TOKEN, CRON_SECRET and REDIS_URL via Helm values renders them cleanly.
    const configuredResult = renderAndCheckParity({
      config: { ...values.config },
      secrets: {
        ...values.secrets,
        METRICS_TOKEN: "metrics-secret-token-123456",
        CRON_SECRET: "cron-secret-token-123456",
        REDIS_URL: "redis://localhost:6379",
      },
    });
    expect(configuredResult.missingRequired).toEqual([]);
    expect(configuredResult.unknownKeys).toEqual([]);
    expect(configuredResult.renderedKeys.has("METRICS_TOKEN")).toBe(true);
    expect(configuredResult.renderedKeys.has("CRON_SECRET")).toBe(true);
    expect(configuredResult.renderedKeys.has("REDIS_URL")).toBe(true);
  });

  it("fails parity when an undocumented key is present or a required key is missing (#1336)", () => {
    const withUnknown = renderAndCheckParity({
      config: { ...values.config, UNDOCUMENTED_TYPO_KEY: "value" },
      secrets: { ...values.secrets },
    });
    expect(withUnknown.unknownKeys).toEqual(["UNDOCUMENTED_TYPO_KEY"]);

    const { DATABASE_URL: _removed, ...secretsWithoutDb } = values.secrets;
    const withMissingRequired = renderAndCheckParity({
      config: { ...values.config },
      secrets: secretsWithoutDb,
    });
    expect(withMissingRequired.missingRequired).toContain("DATABASE_URL");
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
