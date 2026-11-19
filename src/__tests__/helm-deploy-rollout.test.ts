// SPDX-License-Identifier: MIT

/**
 * Issues #1331, #1332, #1333 and #1334 — the chart shipped a Deployment that
 * could not be operated safely:
 *
 *   #1331 `replicas: {{ .Values.replicaCount }}` was rendered unconditionally
 *         while autoscaling is on by default, so every `helm upgrade` reset the
 *         replica count the HPA had scaled to and dropped pods mid-deploy.
 *   #1332 the pod template had no checksum annotation, so changing config or
 *         secrets updated the ConfigMap/Secret objects without restarting the
 *         pods — the containers kept the old environment until something else
 *         triggered a rollout.
 *   #1333 `image.tag: latest` + `pullPolicy: Always` left the running build
 *         unpinned: pods of one release could differ, `helm rollback` did not
 *         restore the previous code, and staging could not pin a promotable
 *         build.
 *   #1334 `DATABASE_URL` / `AUTH_SECRET` defaulted to empty strings and were
 *         rendered into a Secret without validation (install succeeded, pod
 *         crash-looped), and the only way to supply secrets was plain-text
 *         values — no `existingSecret` for External Secrets / Sealed Secrets.
 *
 * These are static assertions on the chart sources: they run without a Helm
 * binary so the guard survives in every environment. The rendered manifests
 * are asserted end-to-end in the `helm-lint` job (.github/workflows/ci.yml).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, loadAll } from "js-yaml";

const ROOT = process.cwd();
const CHART = join(ROOT, "helm", "ophirpay");
const TEMPLATES = join(CHART, "templates");

const read = (...segments: string[]) => readFileSync(join(...segments), "utf8");

interface ChartValues {
  replicaCount: number;
  image: {
    repository: string;
    tag: string;
    digest: string;
    pullPolicy: string;
  };
  autoscaling: { enabled: boolean };
  podAnnotations: Record<string, string>;
  secrets: Record<string, string>;
}

interface ChartMetadata {
  appVersion: string;
}

interface ValuesSchema {
  properties: {
    image: {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { pattern?: string }>;
    };
  };
}

interface K8sDoc {
  kind?: string;
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        containers?: Array<{ image?: string; imagePullPolicy?: string }>;
      };
    };
  };
}

const values = load(read(CHART, "values.yaml")) as ChartValues;
const chart = load(read(CHART, "Chart.yaml")) as ChartMetadata;
const schema = JSON.parse(read(CHART, "values.schema.json")) as ValuesSchema;

const deploymentTemplate = read(TEMPLATES, "deployment.yaml");
const configTemplate = read(TEMPLATES, "config.yaml");
const helpers = read(TEMPLATES, "_helpers.tpl");
const k8sDocs = loadAll(read(ROOT, "k8s", "deployment.yaml")) as K8sDoc[];

describe("#1331 — the HPA owns the replica count", () => {
  it("enables autoscaling by default, which is the case the template must handle", () => {
    expect(values.autoscaling.enabled).toBe(true);
  });

  it("guards spec.replicas behind `if not .Values.autoscaling.enabled`", () => {
    expect(deploymentTemplate).toMatch(
      /\{\{-\s*if not \.Values\.autoscaling\.enabled \}\}\s*\n\s*replicas: \{\{ \.Values\.replicaCount \}\}\s*\n\s*\{\{-\s*end \}\}/,
    );
  });

  it("keeps the standalone manifest free of spec.replicas while it ships an HPA", () => {
    expect(k8sDocs.some((doc) => doc.kind === "HorizontalPodAutoscaler")).toBe(
      true,
    );

    const deployment = k8sDocs.find((doc) => doc.kind === "Deployment");
    expect(deployment).toBeDefined();
    expect(deployment?.spec?.replicas).toBeUndefined();
  });
});

describe("#1332 — config and secret changes roll the pods", () => {
  it("annotates the pod template with a checksum of the rendered config", () => {
    expect(deploymentTemplate).toContain(
      'checksum/config: {{ include (print $.Template.BasePath "/config.yaml") . | sha256sum }}',
    );
  });

  it("puts the checksum on the pod template, not on the Deployment metadata", () => {
    // Only a change to spec.template triggers a rolling update, so an
    // annotation that lands on the Deployment metadata would be inert.
    const checksumAt = deploymentTemplate.indexOf("checksum/config:");

    expect(checksumAt).toBeGreaterThan(deploymentTemplate.indexOf("  template:"));
    expect(checksumAt).toBeLessThan(deploymentTemplate.indexOf("    spec:"));
  });

  it("still renders the operator-supplied pod annotations", () => {
    expect(deploymentTemplate).toMatch(
      /\{\{-\s*with \.Values\.podAnnotations \}\}\s*\n\s*\{\{-\s*toYaml \. \| nindent 8 \}\}/,
    );
    expect(values.podAnnotations["prometheus.io/scrape"]).toBe("true");
  });
});

describe("#1333 — the image reference is immutable", () => {
  it("defaults image.tag to empty and pullPolicy to IfNotPresent", () => {
    expect(values.image.repository).not.toBe("");
    expect(values.image.tag).toBe("");
    expect(values.image.digest).toBe("");
    expect(values.image.pullPolicy).toBe("IfNotPresent");
  });

  it("falls back to Chart.appVersion instead of the mutable `latest` tag", () => {
    expect(chart.appVersion).toBe("1.0.0");
    expect(deploymentTemplate).toContain(
      'image: {{ include "ophirpay.image" . | quote }}',
    );
    expect(helpers).toContain("(.Values.image.tag | default .Chart.AppVersion)");
  });

  it("renders an immutable digest reference when image.digest is set", () => {
    expect(helpers).toContain('printf "%s@%s"');
    expect(helpers).toContain('regexMatch "^sha256:[a-f0-9]{64}$"');
    expect(helpers).toContain("image.digest must be an immutable");
  });

  it("pins the standalone manifest to the chart appVersion", () => {
    const container = k8sDocs.find((doc) => doc.kind === "Deployment")?.spec
      ?.template?.spec?.containers?.[0];

    expect(container?.image).toBe(
      `ghcr.io/ophirpay/ophirpay:${chart.appVersion}`,
    );
    expect(container?.image).not.toMatch(/:latest$/);
    expect(container?.imagePullPolicy).toBe("IfNotPresent");
  });

  it("keeps values.schema.json in step with the new image values", () => {
    const imageSchema = schema.properties.image;
    const digestSchema = imageSchema.properties["digest"];

    expect(imageSchema.required).not.toContain("tag");
    expect(imageSchema.required).toEqual(
      expect.arrayContaining(["repository", "pullPolicy"]),
    );
    expect(digestSchema?.pattern).toContain("sha256:");
    expect(imageSchema.additionalProperties).toBe(false);
  });
});

describe("#1334 — secrets are validated or supplied externally", () => {
  it("ships an empty existingSecret so the chart owns its Secret by default", () => {
    expect(values.secrets.existingSecret).toBe("");
  });

  it("skips rendering the Secret when existingSecret is set", () => {
    expect(configTemplate).toMatch(
      /\{\{-\s*if not \.Values\.secrets\.existingSecret \}\}/,
    );
    // The Secret object lives inside that guard: the template ends with its
    // closing `end`, so setting existingSecret renders the ConfigMap only.
    expect(configTemplate.trimEnd().endsWith("{{- end }}")).toBe(true);
  });

  it("fails fast with a descriptive error when the required secrets are empty", () => {
    expect(configTemplate).toMatch(
      /required "[^"]*secrets\.DATABASE_URL[^"]*" \.Values\.secrets\.DATABASE_URL/,
    );
    expect(configTemplate).toMatch(
      /required "[^"]*secrets\.AUTH_SECRET[^"]*" \.Values\.secrets\.AUTH_SECRET/,
    );
  });

  it("points the Deployment at the resolved Secret name", () => {
    expect(deploymentTemplate).toContain(
      'name: {{ include "ophirpay.secretName" . }}',
    );
    expect(helpers).toContain('define "ophirpay.secretName"');
    expect(helpers).toContain('printf "%s-secrets"');
  });

  it("documents the external-secrets / sealed-secrets workflow", () => {
    const docs = read(ROOT, "docs", "DEPLOYMENT.md");

    expect(docs).toContain("existingSecret");
    expect(docs).toMatch(/External Secrets/i);
    expect(docs).toMatch(/Sealed Secrets/i);
  });

  it("keeps CI renders working through fake values in values.ci.yaml", () => {
    const ciValues = load(read(CHART, "values.ci.yaml")) as ChartValues;

    expect(ciValues.secrets.DATABASE_URL).not.toBe("");
    expect(ciValues.secrets.AUTH_SECRET).not.toBe("");
  });
});
