import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { load } from "js-yaml";

describe("Issue #1307: Helm chart value validation and lint CI job", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const chartDir = path.join(repoRoot, "helm", "ophirpay");
  const ciValuesPath = path.join(chartDir, "values.ci.yaml");
  const prodValuesPath = path.join(chartDir, "values.yaml");
  const schemaPath = path.join(chartDir, "values.schema.json");
  const ciWorkflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");

  it("ensures values.ci.yaml exists and parses as valid YAML", () => {
    expect(fs.existsSync(ciValuesPath)).toBe(true);
    const rawCi = fs.readFileSync(ciValuesPath, "utf8");
    const parsed = load(rawCi) as Record<string, any>;
    expect(parsed).toBeTypeOf("object");
    expect(parsed.replicaCount).toBe(1);
    expect(parsed.image?.tag).toBe("ci-test");
    expect(parsed.config).toBeTypeOf("object");
    expect(parsed.secrets).toBeTypeOf("object");
  });

  it("ensures values.schema.json exists and defines draft-07 JSON Schema", () => {
    expect(fs.existsSync(schemaPath)).toBe(true);
    const rawSchema = fs.readFileSync(schemaPath, "utf8");
    const schema = JSON.parse(rawSchema);
    expect(schema.$schema).toContain("json-schema.org");
    expect(schema.required).toContain("replicaCount");
    expect(schema.required).toContain("image");
    expect(schema.required).toContain("service");
    expect(schema.required).toContain("config");
    expect(schema.required).toContain("secrets");
  });

  it("ensures production values.yaml retains valid configuration", () => {
    const rawProd = fs.readFileSync(prodValuesPath, "utf8");
    const parsed = load(rawProd) as Record<string, any>;
    expect(parsed.replicaCount).toBe(2);
    expect(parsed.service?.port).toBe(80);
    expect(parsed.config?.NEXT_PUBLIC_STELLAR_NETWORK).toBe("TESTNET");
  });

  it("ensures CI workflow includes values.ci.yaml lint and kubeconform 1.28+ validation", () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, "utf8");
    expect(ciContent).toContain("values.ci.yaml");
    expect(ciContent).toMatch(/helm\s+lint\s+helm\/ophirpay\s+--strict\s+-f\s+helm\/ophirpay\/values\.ci\.yaml/);
    expect(ciContent).toMatch(/kubeconform\s+-strict\s+-summary\s+-kubernetes-version\s+1\.28\.0/);
    expect(ciContent).toContain("/tmp/ci.yaml");
  });
});
