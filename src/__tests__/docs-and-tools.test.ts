// SPDX-License-Identifier: MIT

import { existsSync,readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect,it } from "vitest";

const root = process.cwd();

describe("Documentation & Tooling Verification", () => {
  describe("CORS Policy Guide (Issue #2015)", () => {
    const corsDocPath = join(root, "docs", "api", "cors.md");

    it("exists and has substantial content", () => {
      expect(existsSync(corsDocPath)).toBe(true);
      const content = readFileSync(corsDocPath, "utf8");
      expect(content.length).toBeGreaterThan(1000);
    });

    it("documents Access-Control-Allow-Origin and environment variables", () => {
      const content = readFileSync(corsDocPath, "utf8");
      expect(content).toContain("Access-Control-Allow-Origin");
      expect(content).toContain("ALLOWED_ORIGINS");
      expect(content).toContain("NEXT_PUBLIC_APP_URL");
    });

    it("lists allowed HTTP headers and methods", () => {
      const content = readFileSync(corsDocPath, "utf8");
      expect(content).toContain("Access-Control-Allow-Methods");
      expect(content).toContain("GET, POST, PUT, DELETE, PATCH, OPTIONS");
      expect(content).toContain("Access-Control-Allow-Headers");
      expect(content).toContain("Authorization");
      expect(content).toContain("X-API-Key");
      expect(content).toContain("X-Request-Id");
    });

    it("documents credentials and wildcard protection", () => {
      const content = readFileSync(corsDocPath, "utf8");
      expect(content).toContain("Access-Control-Allow-Credentials");
      expect(content).toContain("Wildcard");
    });

    it("provides code example for external dApp fetch request", () => {
      const content = readFileSync(corsDocPath, "utf8");
      expect(content).toContain("createPaymentCrossdomain");
      expect(content).toContain("credentials: \"include\"");
    });
  });

  describe("Postman & Insomnia Collection (Issue #2016)", () => {
    const collectionPath = join(root, "examples", "postman_collection.json");
    const apiReadmePath = join(root, "docs", "api", "README.md");

    it("postman_collection.json exists and is valid JSON conforming to schema v2.1.0", () => {
      expect(existsSync(collectionPath)).toBe(true);
      const raw = readFileSync(collectionPath, "utf8");
      const collection = JSON.parse(raw);
      expect(collection.info).toBeDefined();
      expect(collection.info.schema).toContain("v2.1.0");
      expect(collection.info.name).toContain("OphirPay");
      expect(Array.isArray(collection.variable)).toBe(true);
      expect(Array.isArray(collection.item)).toBe(true);
    });

    it("collection contains essential payment, batch, escrow, and health endpoints", () => {
      const raw = readFileSync(collectionPath, "utf8");
      const collection = JSON.parse(raw);
      const folderNames = collection.item.map((f: { name: string }) => f.name);
      expect(folderNames).toContain("Health & Monitoring");
      expect(folderNames).toContain("Payments");
      expect(folderNames).toContain("Batches");
      expect(folderNames).toContain("Escrows");
      expect(folderNames).toContain("Authentication & API Keys");

      // Verify baseUrl variable
      const varKeys = collection.variable.map((v: { key: string }) => v.key);
      expect(varKeys).toContain("baseUrl");
      expect(varKeys).toContain("apiKey");
    });

    it("docs/api/README.md documents import steps for Postman and Insomnia", () => {
      expect(existsSync(apiReadmePath)).toBe(true);
      const content = readFileSync(apiReadmePath, "utf8");
      expect(content).toContain("Postman Import");
      expect(content).toContain("Insomnia Import");
      expect(content).toContain("postman_collection.json");
      expect(content).toContain("baseUrl");
      expect(content).toContain("apiKey");
    });
  });

  describe("Gas Optimization & Benchmarks (Issue #2017)", () => {
    const gasDocPath = join(root, "docs", "GAS.md");

    it("exists and has substantial content", () => {
      expect(existsSync(gasDocPath)).toBe(true);
      const content = readFileSync(gasDocPath, "utf8");
      expect(content.length).toBeGreaterThan(2000);
    });

    it("documents storage fee mechanics and rent calculations", () => {
      const content = readFileSync(gasDocPath, "utf8");
      expect(content).toContain("Storage Fee Mechanics");
      expect(content).toContain("Instance Storage");
      expect(content).toContain("Persistent Storage");
      expect(content).toContain("Temporary Storage");
      expect(content).toContain("TTL");
      expect(content).toContain("BUMP_MAX_TTL");
    });

    it("documents batching benefits over sequential payments", () => {
      const content = readFileSync(gasDocPath, "utf8");
      expect(content).toContain("Batching vs Sequential Payments");
      expect(content).toContain("Inclusion Fee");
      expect(content).toContain("create_batch");
      expect(content).toContain("Savings");
    });

    it("documents Soroban 128KB WASM budget limit and optimization flags", () => {
      const content = readFileSync(gasDocPath, "utf8");
      expect(content).toContain("128 KB");
      expect(content).toContain("opt-level = \"z\"");
      expect(content).toContain("wasm-strip");
      expect(content).toContain("wasm-opt -Oz");
    });

    it("references automated contract regression reporting CI workflow", () => {
      const content = readFileSync(gasDocPath, "utf8");
      expect(content).toContain("contract-regression.yml");
      expect(content).toContain("fee-baseline.json");
    });
  });

  describe("Prometheus & Grafana Monitoring Guide (Issue #2018)", () => {
    const monitoringReadmePath = join(root, "monitoring", "README.md");
    const alertRulesPath = join(root, "monitoring", "alert-rules.yml");
    const deploymentDocPath = join(root, "docs", "DEPLOYMENT.md");

    it("monitoring/README.md and monitoring/alert-rules.yml exist", () => {
      expect(existsSync(monitoringReadmePath)).toBe(true);
      expect(existsSync(alertRulesPath)).toBe(true);
    });

    it("documents Prometheus scrape config with bearer token authentication", () => {
      const content = readFileSync(monitoringReadmePath, "utf8");
      expect(content).toContain("/api/metrics");
      expect(content).toContain("Bearer");
      expect(content).toContain("METRICS_TOKEN");
    });

    it("explains alert thresholds for payment error rates and RPC drops", () => {
      const content = readFileSync(monitoringReadmePath, "utf8");
      expect(content).toContain("ApiHighErrorRate");
      expect(content).toContain("PaymentProcessingLatencyHigh");
      expect(content).toContain("RpcFailoverDegraded");
      expect(content).toContain("RpcFailoverFrequent");
      expect(content).toContain("OphirPayRpcProviderDegraded");
    });

    it("documents Grafana dashboard import steps", () => {
      const content = readFileSync(monitoringReadmePath, "utf8");
      expect(content).toContain("Grafana Dashboard Import");
      expect(content).toContain("grafana-dashboard.json");
      expect(content).toContain("prometheus");
    });

    it("docs/DEPLOYMENT.md links to monitoring guide", () => {
      const content = readFileSync(deploymentDocPath, "utf8");
      expect(content).toContain("Monitoring and Observability");
      expect(content).toContain("monitoring/README.md");
    });
  });
});
