// SPDX-License-Identifier: MIT
/**
 * @vitest-environment node
 *
 * Supply-chain and backup-resilience guards — issues #749, #750, #751, #752.
 *
 * The workflow and manifest files asserted here fail *silently* when they drift:
 * an image tag that quietly reverts to `latest`, a release that stops attaching
 * an SBOM, a restore drill that stops failing on a bad backup, or a freshness
 * assertion that never runs. Each assertion below turns one of those silent
 * regressions into a loud test failure.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const root = process.cwd();
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const exists = (rel: string): boolean => existsSync(join(root, rel));

// ── #749 + #750: release workflow publishes an immutable, attested image ────

describe("release workflow — image publishing (#749)", () => {
  const path = ".github/workflows/release.yml";
  const raw = read(path);
  const workflow = load(raw) as {
    permissions?: Record<string, string>;
    jobs?: Record<string, { permissions?: Record<string, string> }>;
  };

  it("exists", () => {
    expect(exists(path)).toBe(true);
  });

  it("triggers on version tags and exposes a manual dry run", () => {
    expect(raw).toMatch(/tags:\s*\n\s*-\s*"v\*\.\*\.\*"/);
    expect(raw).toContain("workflow_dispatch:");
    expect(raw).toMatch(/dry_run:/);
  });

  it("grants the permissions the registry push and attestations need", () => {
    const build = workflow.jobs?.build?.permissions ?? {};
    expect(build.packages).toBe("write");
    expect(build["id-token"]).toBe("write");
    expect(build.attestations).toBe("write");
  });

  it("builds both architectures", () => {
    expect(raw).toContain("linux/amd64,linux/arm64");
  });

  it("tags with the semantic version and the commit SHA", () => {
    expect(raw).toMatch(/type=raw,value=\$\{\{\s*steps\.meta\.outputs\.version\s*\}\}/);
    expect(raw).toMatch(/type=sha,format=long,prefix=sha-/);
  });

  it("moves `latest` only for a non-prerelease tag push", () => {
    // `latest` must be explicitly gated, never unconditional.
    expect(raw).toMatch(
      /type=raw,value=latest,enable=\$\{\{\s*github\.event_name == 'push' && !contains\(steps\.meta\.outputs\.version, '-'\)\s*\}\}/,
    );
  });
});

describe("release workflow — SBOM & provenance (#750)", () => {
  const raw = read(".github/workflows/release.yml");

  it("asks BuildKit for an in-registry SBOM and provenance", () => {
    expect(raw).toMatch(/provenance:\s*mode=max/);
    expect(raw).toMatch(/sbom:\s*true/);
  });

  it("generates an image SBOM and a dependency SBOM", () => {
    expect(raw).toMatch(/syft[\s\S]*spdx-json=/);
    expect(raw).toMatch(/npm sbom --sbom-format cyclonedx/);
  });

  it("attests provenance and the SBOM and can be verified for the digest", () => {
    expect(raw).toContain("actions/attest-build-provenance@v2");
    expect(raw).toContain("actions/attest-sbom@v2");
    expect(raw).toMatch(/subject-digest:\s*\$\{\{\s*steps\.build\.outputs\.digest\s*\}\}/);
  });
});

describe("immutable image tags in the manifests (#749)", () => {
  it("k8s/deployment.yaml pins a version tag and does not use `latest`", () => {
    const deployment = read("k8s/deployment.yaml");
    expect(deployment).not.toMatch(/image:\s*ghcr\.io\/ophirpay\/ophirpay:latest/);
    expect(deployment).toMatch(/image:\s*ghcr\.io\/ophirpay\/ophirpay:v\d+\.\d+\.\d+/);
    expect(deployment).toMatch(/imagePullPolicy:\s*IfNotPresent/);
  });

  it("helm values pin a version tag and document the override", () => {
    const values = load(read("helm/ophirpay/values.yaml")) as {
      image: { repository: string; tag: string; pullPolicy: string };
    };
    expect(values.image.repository).toBe("ghcr.io/ophirpay/ophirpay");
    expect(values.image.tag).not.toBe("latest");
    expect(values.image.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(values.image.pullPolicy).toBe("IfNotPresent");

    const raw = read("helm/ophirpay/values.yaml");
    expect(raw).toMatch(/--set image\.tag=/);
  });
});

// ── #751: the restore drill runs and fails on a bad backup ──────────────────

describe("restore drill workflow (#751)", () => {
  const path = ".github/workflows/db-restore-drill.yml";
  const raw = read(path);

  it("exists, runs on a schedule and on demand", () => {
    expect(exists(path)).toBe(true);
    expect(raw).toMatch(/schedule:/);
    expect(raw).toMatch(/cron:\s*"0 5 \* \* 1"/);
    expect(raw).toContain("workflow_dispatch:");
  });

  it("uses the existing drill script", () => {
    expect(raw).toMatch(/scripts\/restore-drill\.sh/);
    // A corrupt/missing backup must fail the run, not be reported healthy.
    expect(raw).toContain("set -o pipefail");
  });

  it("allows pointing the drill at an explicit (possibly corrupt) backup", () => {
    expect(raw).toMatch(/backup_key:/);
  });
});

describe("restore-drill script verification set (#751)", () => {
  const script = read("scripts/restore-drill.sh");

  it("fails on an empty or corrupt gzip before restoring", () => {
    expect(script).toMatch(/gzip -t/);
    expect(script).toMatch(/is not a valid gzip file/);
    expect(script).toMatch(/is empty/);
  });

  it("asserts row counts on the real core tables", () => {
    for (const table of [
      "Payment",
      "Batch",
      "Recurrence",
      "ScheduledPayment",
      "PaymentRequest",
      "Webhook",
      "WebhookDelivery",
      "Refund",
      "User",
    ]) {
      expect(script, `${table} must be part of the drill`).toContain(`"${table}"`);
    }
  });

  it("fails (not warns) when a core table is missing", () => {
    expect(script).toMatch(/fail "\$\{table\}: missing or unqueryable/);
    expect(script).toMatch(/exit 1/);
  });

  it("checks prisma migrate status against the restored database", () => {
    expect(script).toContain("prisma migrate status");
    expect(script).toContain("_prisma_migrations");
  });
});

// ── #752: backup failures alert, freshness is asserted, retention documented ─

describe("db-backup workflow — monitoring & alerting (#752)", () => {
  const raw = read(".github/workflows/db-backup.yml");
  const workflow = load(raw) as {
    jobs: Record<
      string,
      { permissions?: Record<string, string>; needs?: string[]; if?: string }
    >;
  };

  it("runs the backup and an independent freshness monitor", () => {
    expect(raw).toMatch(/cron:\s*"0 3 \* \* \*"/);
    expect(raw).toMatch(/cron:\s*"0 9 \* \* \*"/);
    expect(workflow.jobs.monitor).toBeDefined();
  });

  it("asserts freshness rather than assuming it", () => {
    expect(raw).toMatch(/BACKUP_MAX_AGE_HOURS/);
    expect(raw).toMatch(/exceeding the \$\{BACKUP_MAX_AGE_HOURS\}h freshness policy/);
  });

  it("notifies maintainers on failure by opening/updating an issue", () => {
    const notify = workflow.jobs.notify;
    expect(notify).toBeDefined();
    expect(notify.permissions?.issues).toBe("write");
    expect(notify.needs).toEqual(expect.arrayContaining(["backup", "monitor"]));
    // A skipped dependency must not skip the notification.
    expect(notify.if).toMatch(/always\(\)/);
    expect(raw).toContain("actions/github-script@v7");
    expect(raw).toMatch(/issues\.create|issues\.createComment/);
  });

  it("documents the retention policy", () => {
    expect(raw).toMatch(/BACKUP_RETENTION_DAYS:\s*30/);
    expect(raw).toMatch(/BACKUP_WEEKLY_RETENTION_DAYS:\s*90/);
  });
});

// ── Documentation: verification, retention, and drill steps ─────────────────

describe("release & recovery documentation", () => {
  it("RELEASE.md documents how to verify provenance and SBOMs", () => {
    const release = read("RELEASE.md");
    expect(release).toContain("gh attestation verify");
    expect(release).toMatch(/cosign verify/);
    expect(release).toMatch(/SBOM/i);
    expect(release).toMatch(/dry_run=true/);
  });

  it("DEPLOYMENT.md documents the restore drill and verification", () => {
    const deployment = read("docs/DEPLOYMENT.md");
    expect(deployment).toMatch(/db-restore-drill\.yml/);
    expect(deployment).toContain("gh attestation verify");
  });

  it("DISASTER_RECOVERY.md records freshness and retention", () => {
    const dr = read("docs/DISASTER_RECOVERY.md");
    expect(dr).toMatch(/Freshness assertion/i);
    expect(dr).toMatch(/BACKUP_MAX_AGE_HOURS/);
    expect(dr).toMatch(/Retention policy/i);
    expect(dr).toMatch(/90 days/);
  });
});
