#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// ─────────────────────────────────────────────────────────────────────────────
// OphirPay — SBOM Generator (CycloneDX & SPDX)
// ─────────────────────────────────────────────────────────────────────────────
// Generates machine-readable Software Bill of Materials (SBOM) in CycloneDX
// v1.5 and SPDX 2.3 formats from package.json and package-lock.json.
//
// Used in release pipelines to inventory shipped application dependencies,
// attach to GitHub Releases, and generate cryptographically verifiable build
// provenance attestations.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUTPUT_DIR = join(ROOT, "build", "sbom");

/**
 * Extracts dependency list from package-lock.json packages field.
 *
 * @param {object} packageLock
 * @returns {Array<{name: string, version: string, integrity?: string, resolved?: string, dev?: boolean}>}
 */
export function extractDependenciesFromLockfile(packageLock) {
  const deps = [];
  const packages = packageLock?.packages ?? {};

  for (const [pkgPath, details] of Object.entries(packages)) {
    // Skip root package definition
    if (!pkgPath || pkgPath === "") continue;

    const parts = pkgPath.split("node_modules/");
    const name = parts[parts.length - 1];
    if (!name) continue;

    deps.push({
      name,
      version: details.version || "0.0.0",
      integrity: details.integrity,
      resolved: details.resolved,
      dev: Boolean(details.dev),
    });
  }

  // Deduplicate by name and version
  const seen = new Set();
  return deps.filter((d) => {
    const key = `${d.name}@${d.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Converts npm SHA integrity string (e.g. sha512-...) to CycloneDX hash format.
 * @param {string} [integrity]
 * @returns {Array<{alg: string, content: string}>}
 */
export function parseIntegrityToHashes(integrity) {
  if (!integrity || typeof integrity !== "string") return [];
  const parts = integrity.split("-");
  if (parts.length < 2) return [];

  const algMap = {
    sha512: "SHA-512",
    sha384: "SHA-384",
    sha256: "SHA-256",
    sha1: "SHA-1",
  };

  const alg = algMap[parts[0].toLowerCase()];
  if (!alg) return [];
  const content = parts.slice(1).join("-");
  return [{ alg, content }];
}

/**
 * Generates CycloneDX v1.5 SBOM JSON.
 *
 * @param {object} packageJson
 * @param {object} packageLockJson
 * @param {object} [options]
 * @returns {Record<string, any>}
 */
export function generateCycloneDxSbom(packageJson, packageLockJson, options = {}) {
  const name = packageJson?.name || "ophirpay";
  const version = packageJson?.version || "0.1.0";
  const description = packageJson?.description || "Non-custodial Stellar payment operations platform";
  const license = packageJson?.license || "MIT";
  const now = (options.now || new Date()).toISOString();
  const uuid = options.uuid || randomUUID();

  const dependencies = extractDependenciesFromLockfile(packageLockJson);

  const components = dependencies.map((dep) => {
    const hashes = parseIntegrityToHashes(dep.integrity);
    const comp = {
      type: "library",
      name: dep.name,
      version: dep.version,
      purl: `pkg:npm/${dep.name.startsWith("@") ? encodeURIComponent(dep.name) : dep.name}@${dep.version}`,
      scope: dep.dev ? "excluded" : "required",
    };
    if (hashes.length > 0) comp.hashes = hashes;
    return comp;
  });

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${uuid}`,
    version: 1,
    metadata: {
      timestamp: now,
      tools: [
        {
          vendor: "OphirPay",
          name: "ophirpay-sbom-generator",
          version: "1.0.0",
        },
      ],
      component: {
        type: "application",
        name,
        version,
        description,
        licenses: [{ license: { id: license } }],
        purl: `pkg:npm/${name}@${version}`,
      },
    },
    components,
  };
}

/**
 * Generates SPDX 2.3 SBOM JSON.
 *
 * @param {object} packageJson
 * @param {object} packageLockJson
 * @param {object} [options]
 * @returns {Record<string, any>}
 */
export function generateSpdxSbom(packageJson, packageLockJson, options = {}) {
  const name = packageJson?.name || "ophirpay";
  const version = packageJson?.version || "0.1.0";
  const now = (options.now || new Date()).toISOString();
  const dependencies = extractDependenciesFromLockfile(packageLockJson);

  const packages = [
    {
      name,
      SPDXID: "SPDXRef-RootPackage",
      versionInfo: version,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: packageJson?.license || "MIT",
      licenseDeclared: packageJson?.license || "MIT",
      copyrightText: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:npm/${name}@${version}`,
        },
      ],
    },
    ...dependencies.map((dep, index) => {
      const sanitizedName = dep.name.replace(/[^a-zA-Z0-9.-]/g, "-");
      const spdxId = `SPDXRef-Package-${sanitizedName}-${index}`;
      return {
        name: dep.name,
        SPDXID: spdxId,
        versionInfo: dep.version,
        downloadLocation: dep.resolved || "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        copyrightText: "NOASSERTION",
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: `pkg:npm/${dep.name}@${dep.version}`,
          },
        ],
      };
    }),
  ];

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${name}-sbom`,
    documentNamespace: `https://ophirpay.com/spdx/${name}/${version}/${options.uuid || randomUUID()}`,
    creationInfo: {
      created: now,
      creators: ["Tool: OphirPay-sbom-generator-1.0.0", "Organization: OphirPay"],
    },
    packages,
  };
}

/**
 * Main file generation helper.
 *
 * @param {object} [options]
 * @param {string} [options.outputDir]
 * @param {string} [options.packageJsonPath]
 * @param {string} [options.packageLockPath]
 * @param {string} [options.format="both"]
 */
export function writeSboms(options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  const pkgPath = options.packageJsonPath || join(ROOT, "package.json");
  const lockPath = options.packageLockPath || join(ROOT, "package-lock.json");
  const format = (options.format || "both").toLowerCase();

  if (!existsSync(pkgPath)) {
    throw new Error(`[generate-sbom] package.json not found at ${pkgPath}`);
  }
  if (!existsSync(lockPath)) {
    throw new Error(`[generate-sbom] package-lock.json not found at ${lockPath}`);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));

  mkdirSync(outputDir, { recursive: true });
  const outputs = [];

  if (format === "both" || format === "cyclonedx") {
    const cdx = generateCycloneDxSbom(pkg, lock, options);
    const cdxFile = join(outputDir, "ophirpay-node-sbom.cdx.json");
    writeFileSync(cdxFile, JSON.stringify(cdx, null, 2), "utf8");
    outputs.push({ format: "CycloneDX 1.5", path: cdxFile, componentsCount: cdx.components.length });
  }

  if (format === "both" || format === "spdx") {
    const spdx = generateSpdxSbom(pkg, lock, options);
    const spdxFile = join(outputDir, "ophirpay-node-sbom.spdx.json");
    writeFileSync(spdxFile, JSON.stringify(spdx, null, 2), "utf8");
    outputs.push({ format: "SPDX 2.3", path: spdxFile, packagesCount: spdx.packages.length });
  }

  return outputs;
}

export async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(`Usage: node scripts/generate-sbom.mjs [--format cyclonedx|spdx|both] [--out-dir <path>]

Generates CycloneDX and SPDX SBOM files for OphirPay dependencies.
Outputs to build/sbom/ by default.
`);
    process.exit(0);
  }

  let format = "both";
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format" && args[i + 1]) {
      format = args[++i];
    } else if (args[i] === "--out-dir" && args[i + 1]) {
      outputDir = resolve(args[++i]);
    }
  }

  console.log("Generating Software Bill of Materials (SBOM)...");
  const outputs = writeSboms({ format, outputDir });
  for (const out of outputs) {
    console.log(`  ✅ Generated ${out.format}: ${out.path}`);
  }
}

// Run main if invoked directly
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((err) => {
    console.error("[generate-sbom] Error:", err.message);
    process.exit(1);
  });
}
