// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { FEATURE_FLAGS, isFeatureEnabled, overrideFeatureFlag, type FeatureFlag } from "@/lib/feature-flags";
import { STORAGE_KEYS } from "@/lib/storage-keys";
import { validateEnv } from "@/lib/env";

describe("Feature Flags Matrix & Override Documentation Conformance", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const docPath = path.join(repoRoot, "docs/FEATURE_FLAGS.md");
  const envExamplePath = path.join(repoRoot, ".env.example");
  const deploymentDocPath = path.join(repoRoot, "docs/DEPLOYMENT.md");

  it("docs/FEATURE_FLAGS.md exists and is documented comprehensively", () => {
    expect(fs.existsSync(docPath)).toBe(true);
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content.length).toBeGreaterThan(1500);
  });

  it("documents every flag declared in src/lib/feature-flags.ts", () => {
    const content = fs.readFileSync(docPath, "utf-8");
    const flags = Object.keys(FEATURE_FLAGS) as FeatureFlag[];

    expect(flags).toContain("MULTI_ASSET");
    expect(flags).toContain("RECURRING_PAYMENTS");
    expect(flags).toContain("WEBHOOKS");
    expect(flags).toContain("ADVANCED_ANALYTICS");
    expect(flags).toContain("API_KEYS");

    for (const flag of flags) {
      expect(content, `Flag ${flag} missing in docs/FEATURE_FLAGS.md`).toContain(flag);
    }
  });

  it("documents all corresponding environment variables in docs and lists them in .env.example", () => {
    const docContent = fs.readFileSync(docPath, "utf-8");
    const envExampleContent = fs.readFileSync(envExamplePath, "utf-8");

    const expectedEnvVars = [
      "NEXT_PUBLIC_FEATURE_MULTI_ASSET",
      "NEXT_PUBLIC_FEATURE_RECURRING",
      "NEXT_PUBLIC_FEATURE_WEBHOOKS",
      "NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS",
      "NEXT_PUBLIC_FEATURE_API_KEYS",
    ];

    for (const envVar of expectedEnvVars) {
      expect(docContent, `${envVar} missing from docs/FEATURE_FLAGS.md`).toContain(envVar);
      expect(envExampleContent, `${envVar} missing from .env.example`).toContain(envVar);
    }
  });

  it("documents build-time inlining and the Helm chart pitfall", () => {
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content).toMatch(/build-time/i);
    expect(content).toMatch(/inlin(ed|ing)/i);
    expect(content).toMatch(/helm/i);
  });

  it("validates all 5 feature flag variables in src/lib/env.ts schema", () => {
    // Calling validateEnv with dummy required vars should pass without throwing schema errors
    const originalEnv = { ...process.env };
    try {
      process.env.DATABASE_URL = "postgresql://localhost:5432/ophirpay";
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET";
      process.env.NEXT_PUBLIC_EMITTER_CONTRACT_ID = "CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN";
      process.env.NEXT_PUBLIC_FEATURE_MULTI_ASSET = "true";
      process.env.NEXT_PUBLIC_FEATURE_RECURRING = "false";
      process.env.NEXT_PUBLIC_FEATURE_WEBHOOKS = "true";
      process.env.NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS = "true";
      process.env.NEXT_PUBLIC_FEATURE_API_KEYS = "true";

      const env = validateEnv();
      expect(env.NEXT_PUBLIC_FEATURE_MULTI_ASSET).toBe("true");
      expect(env.NEXT_PUBLIC_FEATURE_RECURRING).toBe("false");
      expect(env.NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS).toBe("true");
      expect(env.NEXT_PUBLIC_FEATURE_API_KEYS).toBe("true");
    } finally {
      process.env = originalEnv;
    }
  });

  it("documents the localStorage override mechanism with STORAGE_KEYS.FEATURE_FLAG_PREFIX", () => {
    const content = fs.readFileSync(docPath, "utf-8");
    expect(content).toContain("localStorage");
    expect(content).toContain(STORAGE_KEYS.FEATURE_FLAG_PREFIX);
    expect(content).toMatch(/dev(elopment)?-only/i);
  });

  it("corrects feature flag defaults and links to FEATURE_FLAGS.md in docs/DEPLOYMENT.md", () => {
    const deploymentContent = fs.readFileSync(deploymentDocPath, "utf-8");

    expect(deploymentContent).toContain("FEATURE_FLAGS.md");
    // Multi-asset and webhooks default to true (enabled unless set to false)
    expect(deploymentContent).toMatch(/NEXT_PUBLIC_FEATURE_MULTI_ASSET.*true/);
    expect(deploymentContent).toMatch(/NEXT_PUBLIC_FEATURE_WEBHOOKS.*true/);
  });

  describe("localStorage dev-only override runtime behavior", () => {
    const mockStorage: Record<string, string> = {};

    beforeEach(() => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => mockStorage[key] ?? null,
        setItem: (key: string, val: string) => {
          mockStorage[key] = val;
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          for (const k of Object.keys(mockStorage)) delete mockStorage[k];
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      for (const k of Object.keys(mockStorage)) delete mockStorage[k];
    });

    it("respects overrides in development mode", () => {
      vi.stubEnv("NODE_ENV", "development");

      // Override ADVANCED_ANALYTICS to true
      overrideFeatureFlag("ADVANCED_ANALYTICS", true);
      expect(isFeatureEnabled("ADVANCED_ANALYTICS")).toBe(true);
      expect(mockStorage[`${STORAGE_KEYS.FEATURE_FLAG_PREFIX}ADVANCED_ANALYTICS`]).toBe("true");

      // Override MULTI_ASSET to false
      overrideFeatureFlag("MULTI_ASSET", false);
      expect(isFeatureEnabled("MULTI_ASSET")).toBe(false);
    });

    it("ignores overrides in production mode", () => {
      vi.stubEnv("NODE_ENV", "production");

      // Put an override directly in storage
      mockStorage[`${STORAGE_KEYS.FEATURE_FLAG_PREFIX}ADVANCED_ANALYTICS`] = "true";

      // Must still evaluate to the environment/default constant (false), ignoring storage
      expect(isFeatureEnabled("ADVANCED_ANALYTICS")).toBe(FEATURE_FLAGS.ADVANCED_ANALYTICS);

      // Attempting to set an override in production is a no-op
      overrideFeatureFlag("WEBHOOKS", false);
      expect(mockStorage[`${STORAGE_KEYS.FEATURE_FLAG_PREFIX}WEBHOOKS`]).toBeUndefined();
    });
  });
});
