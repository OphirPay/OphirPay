// SPDX-License-Identifier: MIT
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEPLOYMENT_PATH = path.resolve(
  process.cwd(),
  "helm/ophirpay/templates/deployment.yaml"
);
const CONFIG_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "helm/ophirpay/templates/config.yaml"
);
const VALUES_PATH = path.resolve(process.cwd(), "helm/ophirpay/values.yaml");

/**
 * Renders a deterministic representation of `templates/config.yaml` with the
 * given config/secrets overrides and computes its `sha256sum` just like Helm's
 * `{{ include (print $.Template.BasePath "/config.yaml") . | sha256sum }}`.
 */
export function computeHelmConfigChecksum(overrides = {}) {
  const configTemplate = fs.readFileSync(CONFIG_TEMPLATE_PATH, "utf8");
  const valuesYaml = fs.readFileSync(VALUES_PATH, "utf8");
  const payload = JSON.stringify({
    configTemplate,
    valuesYaml,
    configOverrides: overrides.config ?? {},
    secretOverrides: overrides.secrets ?? {},
  });
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export function verifyHelmDeploymentChecksumAnnotation() {
  const deploymentYaml = fs.readFileSync(DEPLOYMENT_PATH, "utf8");
  const expectedAnnotation =
    'checksum/config: {{ include (print $.Template.BasePath "/config.yaml") . | sha256sum }}';

  if (!deploymentYaml.includes(expectedAnnotation)) {
    throw new Error(
      `Missing expected pod template annotation in ${DEPLOYMENT_PATH}: ${expectedAnnotation}`
    );
  }

  const baseHash = computeHelmConfigChecksum();
  const changedConfigHash = computeHelmConfigChecksum({
    config: { RATE_LIMIT_RPM: "240" },
  });
  const changedSecretHash = computeHelmConfigChecksum({
    secrets: { SESSION_SECRET: "rotated-secret-value" },
  });

  if (baseHash === changedConfigHash) {
    throw new Error(
      "Changing a config value did not alter checksum/config hash"
    );
  }
  if (baseHash === changedSecretHash) {
    throw new Error(
      "Changing a secrets value did not alter checksum/config hash"
    );
  }

  return {
    baseHash,
    changedConfigHash,
    changedSecretHash,
  };
}
