// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractDependenciesFromLockfile,
  parseIntegrityToHashes,
  generateCycloneDxSbom,
  generateSpdxSbom,
  writeSboms,
} from "../../scripts/generate-sbom.mjs";

describe("SBOM Generation & Provenance (Issue #750)", () => {
  const mockPackageJson = {
    name: "ophirpay",
    version: "0.1.0",
    description: "Open-source payment platform",
    license: "MIT",
  };

  const mockPackageLockJson = {
    name: "ophirpay",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "ophirpay",
        version: "0.1.0",
      },
      "node_modules/@stellar/stellar-sdk": {
        version: "13.2.0",
        resolved: "https://registry.npmjs.org/@stellar/stellar-sdk/-/stellar-sdk-13.2.0.tgz",
        integrity: "sha512-mockStellarIntegrityHash123==",
        dev: false,
      },
      "node_modules/typescript": {
        version: "5.8.2",
        resolved: "https://registry.npmjs.org/typescript/-/typescript-5.8.2.tgz",
        integrity: "sha512-mockTsIntegrityHash456==",
        dev: true,
      },
    },
  };

  describe("extractDependenciesFromLockfile", () => {
    it("extracts and normalizes packages from package-lock.json", () => {
      const deps = extractDependenciesFromLockfile(mockPackageLockJson);
      expect(deps.length).toBe(2);

      const stellarSdk = deps.find((d) => d.name === "@stellar/stellar-sdk");
      expect(stellarSdk).toBeDefined();
      expect(stellarSdk?.version).toBe("13.2.0");
      expect(stellarSdk?.dev).toBe(false);

      const ts = deps.find((d) => d.name === "typescript");
      expect(ts).toBeDefined();
      expect(ts?.version).toBe("5.8.2");
      expect(ts?.dev).toBe(true);
    });

    it("handles empty or missing packages object gracefully", () => {
      expect(extractDependenciesFromLockfile({})).toEqual([]);
      expect(extractDependenciesFromLockfile({ packages: {} })).toEqual([]);
    });
  });

  describe("parseIntegrityToHashes", () => {
    it("converts sha512 integrity string to CycloneDX format", () => {
      const hashes = parseIntegrityToHashes("sha512-abcdef123456");
      expect(hashes).toEqual([{ alg: "SHA-512", content: "abcdef123456" }]);
    });

    it("converts sha256 and sha384 integrity strings", () => {
      expect(parseIntegrityToHashes("sha256-hash256")).toEqual([{ alg: "SHA-256", content: "hash256" }]);
      expect(parseIntegrityToHashes("sha384-hash384")).toEqual([{ alg: "SHA-384", content: "hash384" }]);
    });

    it("returns empty array for invalid or missing integrity strings", () => {
      expect(parseIntegrityToHashes("")).toEqual([]);
      expect(parseIntegrityToHashes(undefined)).toEqual([]);
      expect(parseIntegrityToHashes("no-dash-here")).toEqual([]);
    });
  });

  describe("generateCycloneDxSbom", () => {
    it("generates compliant CycloneDX 1.5 document structure", () => {
      const fixedUuid = "12345678-1234-1234-1234-123456789abc";
      const fixedNow = new Date("2026-09-25T12:00:00Z");

      const bom: any = generateCycloneDxSbom(mockPackageJson, mockPackageLockJson, {
        uuid: fixedUuid,
        now: fixedNow,
      });

      expect(bom.bomFormat).toBe("CycloneDX");
      expect(bom.specVersion).toBe("1.5");
      expect(bom.serialNumber).toBe(`urn:uuid:${fixedUuid}`);
      expect(bom.metadata.timestamp).toBe(fixedNow.toISOString());
      expect(bom.metadata.component.name).toBe("ophirpay");
      expect(bom.metadata.component.version).toBe("0.1.0");
      expect(bom.metadata.component.purl).toBe("pkg:npm/ophirpay@0.1.0");

      expect(Array.isArray(bom.components)).toBe(true);
      expect(bom.components.length).toBe(2);

      const stellarComp = bom.components.find((c: any) => c.name === "@stellar/stellar-sdk");
      expect(stellarComp).toBeDefined();
      expect(stellarComp.version).toBe("13.2.0");
      expect(stellarComp.purl).toBe("pkg:npm/%40stellar%2Fstellar-sdk@13.2.0");
      expect(stellarComp.scope).toBe("required");
      expect(stellarComp.hashes).toEqual([{ alg: "SHA-512", content: "mockStellarIntegrityHash123==" }]);

      const devComp = bom.components.find((c: any) => c.name === "typescript");
      expect(devComp.scope).toBe("excluded");
    });
  });

  describe("generateSpdxSbom", () => {
    it("generates compliant SPDX 2.3 document structure", () => {
      const fixedNow = new Date("2026-09-25T12:00:00Z");
      const spdx: any = generateSpdxSbom(mockPackageJson, mockPackageLockJson, {
        now: fixedNow,
        uuid: "test-spdx-uuid",
      });

      expect(spdx.spdxVersion).toBe("SPDX-2.3");
      expect(spdx.dataLicense).toBe("CC0-1.0");
      expect(spdx.SPDXID).toBe("SPDXRef-DOCUMENT");
      expect(spdx.name).toBe("ophirpay-sbom");
      expect(spdx.creationInfo.created).toBe(fixedNow.toISOString());

      expect(Array.isArray(spdx.packages)).toBe(true);
      // Root package + 2 dependencies
      expect(spdx.packages.length).toBe(3);
      expect(spdx.packages[0].name).toBe("ophirpay");
      expect(spdx.packages[0].SPDXID).toBe("SPDXRef-RootPackage");
    });
  });

  describe("writeSboms integration", () => {
    const testOutputDir = join(process.cwd(), "build", "test-sbom-output");

    afterEach(() => {
      if (existsSync(testOutputDir)) {
        rmSync(testOutputDir, { recursive: true, force: true });
      }
    });

    it("generates and writes both CycloneDX and SPDX files to disk", () => {
      const results = writeSboms({
        outputDir: testOutputDir,
        format: "both",
      });

      expect(results.length).toBe(2);
      expect(existsSync(join(testOutputDir, "ophirpay-node-sbom.cdx.json"))).toBe(true);
      expect(existsSync(join(testOutputDir, "ophirpay-node-sbom.spdx.json"))).toBe(true);

      const cdxContent = JSON.parse(readFileSync(join(testOutputDir, "ophirpay-node-sbom.cdx.json"), "utf8"));
      expect(cdxContent.bomFormat).toBe("CycloneDX");
      expect(cdxContent.components.length).toBeGreaterThan(0);
    });

    it("throws clear error when package.json is missing", () => {
      expect(() => {
        writeSboms({
          packageJsonPath: "/nonexistent/path/package.json",
        });
      }).toThrow(/package.json not found/);
    });
  });
});
