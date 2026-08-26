// SPDX-License-Identifier: MIT

/**
 * Build-time version management.
 * These are utility functions, not an executable script.
 * For a CI script, use the scripts/ directory or `git describe`.
 */

const VERSION = "0.1.0";

/** Get the current version from git or package.json. */
export function getVersion(): string {
  // In production, this could read from git tags
  // const hash = execSync("git rev-parse --short HEAD").toString().trim();
  return VERSION;
}

/** Generate a version string for display in the UI footer. */
export function getVersionString(): string {
  const env = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC" ? "mainnet" : "testnet";
  return `v${VERSION}-${env}`;
}
