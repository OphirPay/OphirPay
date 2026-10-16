// SPDX-License-Identifier: MIT

/**
 * Issue #684 — a chart value that claims to create a resource must be read by
 * a template.
 *
 * `helm/ophirpay/values.yaml` exposed `autoscaling`, `pdb`, `networkPolicy` and
 * `serviceAccount` while the templates only read some of them, so
 * `--set networkPolicy.enabled=true` produced no policy and
 * `serviceAccount.create=true` produced no ServiceAccount — a false sense of
 * isolation and security. Each opt-in object now lives in its own template,
 * gated on the value that claims to enable it.
 *
 * The rendered output itself is asserted in the `helm-lint` CI job
 * (`.github/workflows/ci.yml`), which runs `helm lint` plus `helm template`
 * with the flags on and off.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const chartDir = join(process.cwd(), "helm", "ophirpay");
const templatesDir = join(chartDir, "templates");

function template(file: string): string {
  const path = join(templatesDir, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const values = load(readFileSync(join(chartDir, "values.yaml"), "utf8")) as Record<
  string,
  unknown
>;

function valueAt(path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object") {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, values);
}

const gatedTemplates = [
  {
    file: "hpa.yaml",
    kind: "HorizontalPodAutoscaler",
    guard: ".Values.autoscaling.enabled",
  },
  { file: "pdb.yaml", kind: "PodDisruptionBudget", guard: ".Values.pdb.enabled" },
  {
    file: "networkpolicy.yaml",
    kind: "NetworkPolicy",
    guard: ".Values.networkPolicy.enabled",
  },
  {
    file: "serviceaccount.yaml",
    kind: "ServiceAccount",
    guard: ".Values.serviceAccount.create",
  },
];

describe.each(gatedTemplates)("$file (#684)", ({ file, kind, guard }) => {
  const contents = template(file);

  it("exists", () => {
    expect(contents, `${file} must exist`).not.toBe("");
  });

  it(`renders a ${kind}`, () => {
    expect(contents).toContain(`kind: ${kind}`);
  });

  it(`is gated on ${guard}`, () => {
    const escaped = guard.replace(/\./g, "\\.");
    expect(contents).toMatch(new RegExp(`\\{\\{-\\s*if\\s+${escaped}\\s*\\}\\}`));
    expect(contents.trimEnd().endsWith("{{- end }}")).toBe(true);
  });

  it("is backed by a value in values.yaml", () => {
    expect(valueAt(guard.replace(".Values.", ""))).toBeDefined();
  });
});

describe("config.yaml (#684)", () => {
  it("only renders the ConfigMap and the Secret", () => {
    const kinds = Array.from(
      template("config.yaml").matchAll(/^kind: (\w+)$/gm),
      (match) => match[1],
    );

    expect(kinds).toEqual(["ConfigMap", "Secret"]);
  });
});

describe("chart inventory (#684)", () => {
  it("ships every flag-gated object as its own template", () => {
    const expected = [
      "_helpers.tpl",
      "config.yaml",
      "deployment.yaml",
      "hpa.yaml",
      "ingress.yaml",
      "networkpolicy.yaml",
      "pdb.yaml",
      "service.yaml",
      "serviceaccount.yaml",
    ];

    for (const file of expected) {
      expect(existsSync(join(templatesDir, file)), `${file} must exist`).toBe(
        true,
      );
    }
  });
});

describe("Helm and k8s immutable image configuration (#1333)", () => {
  const valuesPath = join(chartDir, "values.yaml");
  const chartYamlPath = join(chartDir, "Chart.yaml");
  const deploymentTemplatePath = join(templatesDir, "deployment.yaml");
  const k8sDeploymentPath = join(process.cwd(), "k8s", "deployment.yaml");
  const ciWorkflowPath = join(process.cwd(), ".github", "workflows", "ci.yml");

  it("defaults image.tag to empty, digest to empty, and pullPolicy to IfNotPresent in values.yaml", () => {
    const rawValues = load(readFileSync(valuesPath, "utf8")) as Record<string, any>;
    expect(rawValues.image.repository).toBe("ghcr.io/ophirpay/ophirpay");
    expect(rawValues.image.tag).toBe("");
    expect(rawValues.image.digest).toBe("");
    expect(rawValues.image.pullPolicy).toBe("IfNotPresent");
  });

  it("declares appVersion 1.0.0 in Chart.yaml", () => {
    const rawChart = load(readFileSync(chartYamlPath, "utf8")) as Record<string, any>;
    expect(rawChart.appVersion).toBe("1.0.0");
  });

  it("supports image.digest and defaults image.tag to .Chart.AppVersion in deployment.yaml", () => {
    const templateContent = readFileSync(deploymentTemplatePath, "utf8");
    expect(templateContent).toMatch(
      /\{\{-\s*if\s+\.Values\.image\.digest\s*\}\}\s*\r?\n\s*image:\s*"\{\{\s*\.Values\.image\.repository\s*\}\}@\{\{\s*\.Values\.image\.digest\s*\|\s*trimPrefix\s*"@"\s*\}\}"/
    );
    expect(templateContent).toMatch(
      /\{\{-\s*else\s*\}\}\s*\r?\n\s*image:\s*"\{\{\s*\.Values\.image\.repository\s*\}\}:\{\{\s*\.Values\.image\.tag\s*\|\s*default\s+\.Chart\.AppVersion\s*\}\}"/
    );
  });

  it("pins image tag and sets IfNotPresent in k8s/deployment.yaml", () => {
    const k8sContent = readFileSync(k8sDeploymentPath, "utf8");
    expect(k8sContent).toContain("image: ghcr.io/ophirpay/ophirpay:1.0.0");
    expect(k8sContent).not.toContain("image: ghcr.io/ophirpay/ophirpay:latest");
    expect(k8sContent).toContain("imagePullPolicy: IfNotPresent");
  });

  it("asserts default pinned tag, digest rendering, and kubeconform in CI helm-lint", () => {
    const ciContent = readFileSync(ciWorkflowPath, "utf8");
    expect(ciContent).toContain('expect "ghcr.io/ophirpay/ophirpay:1.0.0" /tmp/default.yaml');
    expect(ciContent).toContain('reject "ghcr.io/ophirpay/ophirpay:latest" /tmp/default.yaml');
    expect(ciContent).toContain('expect "imagePullPolicy: IfNotPresent" /tmp/default.yaml');
    expect(ciContent).toContain(
      'expect "ghcr.io/ophirpay/ophirpay@sha256:45b23dee08af5e43a7ff6c4e1aaec6fa60c6b72d54c4c822d84343a3e65f93aa" /tmp/digest.yaml'
    );
    expect(ciContent).toContain("kubeconform -strict -summary /tmp/digest.yaml");
  });
});
