// SPDX-License-Identifier: MIT
import packageJson from "../../package.json";

/**
 * Returns the application version defined in package.json, falling back
 * to NEXT_PUBLIC_APP_VERSION if provided (#1339).
 */
export function getAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "0.1.0";
}

/**
 * Returns the current short git commit SHA (7 characters if available).
 * Resolves from VERCEL_GIT_COMMIT_SHA, GIT_SHA, or NEXT_PUBLIC_GIT_SHA.
 * Defaults to "development" when unconfigured (#1339).
 */
export function getCommitSha(): string {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.NEXT_PUBLIC_GIT_SHA;
  if (!sha) {
    return "development";
  }
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
