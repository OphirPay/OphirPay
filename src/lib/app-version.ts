// SPDX-License-Identifier: MIT

import packageJson from "../../package.json";

/**
 * Returns the application version string.
 * Uses NEXT_PUBLIC_APP_VERSION if explicitly set, otherwise falls back to
 * the version declared in package.json or npm_package_version.
 */
export function getAppVersion(): string {
  const envVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (envVersion) return envVersion;

  return packageJson.version || process.env.npm_package_version || "0.1.0";
}

/**
 * Returns the short git commit SHA (7 characters) serving the application.
 * Resolved from GIT_SHA, VERCEL_GIT_COMMIT_SHA, NEXT_PUBLIC_GIT_SHA, or GITHUB_SHA.
 * Returns "unknown" when not running in an environment with commit metadata.
 */
export function getCommitSha(): string {
  const sha =
    process.env.GIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_SHA ||
    process.env.GITHUB_SHA;

  if (sha && sha.trim()) {
    return sha.trim().slice(0, 7);
  }

  return "unknown";
}

/**
 * Combined build metadata for health/introspection endpoints.
 */
export function getAppVersionInfo(): { version: string; commit: string } {
  return {
    version: getAppVersion(),
    commit: getCommitSha(),
  };
}
