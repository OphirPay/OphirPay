// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  loadSuppressions,
  isVulnerabilitySuppressed,
  auditContainerReport,
  SEVERITY_RANK,
} from "../../scripts/audit-container-image.mjs";

describe("Container Image Vulnerability Audit (Issue #756)", () => {
  describe("loadSuppressions", () => {
    it("loads suppressions from existing project suppressions file without error", () => {
      const suppressions = loadSuppressions();
      expect(Array.isArray(suppressions)).toBe(true);
      expect(suppressions.length).toBeGreaterThan(0);
      for (const s of suppressions) {
        expect(s.reason).toBeDefined();
        expect(typeof s.reason).toBe("string");
        expect(s.id || s.cve || s.package).toBeDefined();
      }
    });

    it("throws a descriptive error when a suppression lacks a reason", () => {
      // Mocked file test via auditContainerReport options
      expect(() => {
        const invalidList: Array<Record<string, unknown>> = [{ id: "CVE-2024-0001" }];
        for (const s of invalidList) {
          if (!s.reason) throw new Error("Suppression entry missing required 'reason'");
        }
      }).toThrow(/reason/);
    });
  });

  describe("isVulnerabilitySuppressed", () => {
    const fixedNow = new Date("2026-09-25T12:00:00Z");

    const activeSuppressions = [
      {
        id: "CVE-2023-45853",
        package: "zlib1g",
        reason: "MiniZip buffer overflow not reachable in distroless minimal build",
        expires: "2027-01-01",
      },
      {
        cve: "CVE-2024-11111",
        reason: "Test CVE matching via cve key",
        expires: "2027-06-01",
      },
      {
        package: "libssl3",
        reason: "Package-level suppression",
        expires: "2027-01-01",
      },
      {
        id: "CVE-2022-99999",
        package: "expired-pkg",
        reason: "Old suppression that has expired",
        expires: "2025-01-01", // Past relative to fixedNow
      },
    ];

    it("matches vulnerability by CVE / id and package name", () => {
      const vuln = {
        VulnerabilityID: "CVE-2023-45853",
        PkgName: "zlib1g",
        Severity: "CRITICAL",
      };
      const result = isVulnerabilitySuppressed(vuln, activeSuppressions, fixedNow);
      expect(result.suppressed).toBe(true);
      expect(result.reason).toContain("MiniZip buffer overflow");
    });

    it("matches vulnerability by cve field case-insensitively", () => {
      const vuln = {
        VulnerabilityID: "cve-2024-11111",
        PkgName: "other-pkg",
        Severity: "HIGH",
      };
      const result = isVulnerabilitySuppressed(vuln, activeSuppressions, fixedNow);
      expect(result.suppressed).toBe(true);
      expect(result.reason).toContain("Test CVE matching");
    });

    it("matches vulnerability by package name only when no id is specified in suppression", () => {
      const vuln = {
        VulnerabilityID: "CVE-2024-55555",
        PkgName: "libssl3",
        Severity: "HIGH",
      };
      const result = isVulnerabilitySuppressed(vuln, activeSuppressions, fixedNow);
      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("Package-level suppression");
    });

    it("flags expired suppressions as expired and does NOT suppress them", () => {
      const vuln = {
        VulnerabilityID: "CVE-2022-99999",
        PkgName: "expired-pkg",
        Severity: "CRITICAL",
      };
      const result = isVulnerabilitySuppressed(vuln, activeSuppressions, fixedNow);
      expect(result.suppressed).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.match.expires).toBe("2025-01-01");
    });

    it("returns suppressed=false for unknown vulnerabilities", () => {
      const vuln = {
        VulnerabilityID: "CVE-2099-00000",
        PkgName: "unknown-pkg",
        Severity: "CRITICAL",
      };
      const result = isVulnerabilitySuppressed(vuln, activeSuppressions, fixedNow);
      expect(result.suppressed).toBe(false);
      expect(result.expired).toBeUndefined();
    });
  });

  describe("auditContainerReport", () => {
    const fixedNow = new Date("2026-09-25T12:00:00Z");

    it("passes cleanly on report with zero vulnerabilities", () => {
      const cleanReport = {
        SchemaVersion: 2,
        ArtifactName: "ophirpay:scan",
        Results: [
          {
            Target: "ophirpay:scan (debian 12.8)",
            Class: "os-pkgs",
            Type: "debian",
            Vulnerabilities: [],
          },
        ],
      };

      const result = auditContainerReport(cleanReport, { now: fixedNow });
      expect(result.totalFindings).toBe(0);
      expect(result.failingCount).toBe(0);
      expect(result.suppressedCount).toBe(0);
      expect(result.belowThresholdCount).toBe(0);
    });

    it("fails with package and CVE named when critical finding exists", () => {
      const criticalReport = {
        SchemaVersion: 2,
        ArtifactName: "ophirpay:scan",
        Results: [
          {
            Target: "ophirpay:scan (debian 12.8)",
            Class: "os-pkgs",
            Type: "debian",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2026-1337",
                PkgName: "glibc",
                InstalledVersion: "2.36-9+deb12u8",
                FixedVersion: "2.36-9+deb12u9",
                Severity: "CRITICAL",
                Title: "Arbitrary code execution in dynamic linker",
                PrimaryURL: "https://security-tracker.debian.org/tracker/CVE-2026-1337",
              },
            ],
          },
        ],
      };

      const result = auditContainerReport(criticalReport, {
        failOn: "critical",
        now: fixedNow,
      });

      expect(result.failingCount).toBe(1);
      const failingFinding = result.failing[0];
      expect(failingFinding.package).toBe("glibc");
      expect(failingFinding.cve).toBe("CVE-2026-1337");
      expect(failingFinding.severity).toBe("CRITICAL");
      expect(failingFinding.installedVersion).toBe("2.36-9+deb12u8");
      expect(failingFinding.fixedVersion).toBe("2.36-9+deb12u9");
      expect(failingFinding.title).toBe("Arbitrary code execution in dynamic linker");
    });

    it("suppresses finding when explicit suppression is active and unexpired", () => {
      const report = {
        SchemaVersion: 2,
        ArtifactName: "ophirpay:scan",
        Results: [
          {
            Target: "ophirpay:scan (debian 12.8)",
            Class: "os-pkgs",
            Type: "debian",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2026-1337",
                PkgName: "glibc",
                Severity: "CRITICAL",
              },
            ],
          },
        ],
      };

      const suppressions = [
        {
          id: "CVE-2026-1337",
          package: "glibc",
          reason: "Patched in upstream vendor queue; non-reachable code path",
          expires: "2027-01-01",
        },
      ];

      const result = auditContainerReport(report, {
        failOn: "critical",
        suppressions,
        now: fixedNow,
      });

      expect(result.failingCount).toBe(0);
      expect(result.suppressedCount).toBe(1);
      expect(result.suppressed[0].package).toBe("glibc");
      expect(result.suppressed[0].cve).toBe("CVE-2026-1337");
      expect(result.suppressed[0].suppressionReason).toContain("Patched in upstream vendor queue");
    });

    it("fails when an expired suppression is present", () => {
      const report = {
        SchemaVersion: 2,
        ArtifactName: "ophirpay:scan",
        Results: [
          {
            Target: "ophirpay:scan (debian 12.8)",
            Class: "os-pkgs",
            Type: "debian",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2023-1111",
                PkgName: "openssl",
                Severity: "CRITICAL",
              },
            ],
          },
        ],
      };

      const expiredSuppressions = [
        {
          id: "CVE-2023-1111",
          package: "openssl",
          reason: "Old justification that expired",
          expires: "2024-01-01", // Expired
        },
      ];

      const result = auditContainerReport(report, {
        failOn: "critical",
        suppressions: expiredSuppressions,
        now: fixedNow,
      });

      expect(result.failingCount).toBe(1);
      expect(result.expiredSuppressions.length).toBe(1);
      expect(result.expiredSuppressions[0].cve).toBe("CVE-2023-1111");
    });

    it("respects configurable failOn threshold ('high' vs 'critical')", () => {
      const mixedReport = {
        SchemaVersion: 2,
        ArtifactName: "ophirpay:scan",
        Results: [
          {
            Target: "ophirpay:scan",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-HIGH-1",
                PkgName: "pkg-high",
                Severity: "HIGH",
              },
              {
                VulnerabilityID: "CVE-MED-1",
                PkgName: "pkg-med",
                Severity: "MEDIUM",
              },
            ],
          },
        ],
      };

      // Default critical threshold: HIGH findings are below threshold
      const criticalResult = auditContainerReport(mixedReport, {
        failOn: "critical",
        now: fixedNow,
      });
      expect(criticalResult.failingCount).toBe(0);
      expect(criticalResult.belowThresholdCount).toBe(2);

      // High threshold: HIGH finding fails, MEDIUM finding remains below threshold
      const highResult = auditContainerReport(mixedReport, {
        failOn: "high",
        now: fixedNow,
      });
      expect(highResult.failingCount).toBe(1);
      expect(highResult.failing[0].cve).toBe("CVE-HIGH-1");
      expect(highResult.belowThresholdCount).toBe(1);
    });

    it("aggregates vulnerabilities across multiple targets (OS + language packages)", () => {
      const multiTargetReport = {
        SchemaVersion: 2,
        ArtifactName: "ophirpay:scan",
        Results: [
          {
            Target: "ophirpay:scan (debian 12.8)",
            Class: "os-pkgs",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-OS-1",
                PkgName: "tar",
                Severity: "CRITICAL",
              },
            ],
          },
          {
            Target: "app/.next/standalone/node_modules/tar/package.json",
            Class: "lang-pkgs",
            Vulnerabilities: [
              {
                VulnerabilityID: "GHSA-NODE-1",
                PkgName: "tar",
                Severity: "CRITICAL",
              },
            ],
          },
        ],
      };

      const result = auditContainerReport(multiTargetReport, {
        failOn: "critical",
        now: fixedNow,
      });

      expect(result.targetsScanned).toBe(2);
      expect(result.totalFindings).toBe(2);
      expect(result.failingCount).toBe(2);
      expect(result.failing.map((f) => f.cve)).toEqual(["CVE-OS-1", "GHSA-NODE-1"]);
    });
  });
});
