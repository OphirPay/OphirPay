// SPDX-License-Identifier: MIT

import packageJson from "../../package.json";

/**
 * Returns the application version string.
 * Priority: NEXT_PUBLIC_APP_VERSION > package.json version > fallback "0.1.0".
 */
export function getAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "0.1.0";
}

/**
 * Returns the short git commit SHA (7 characters) or "dev" if not present.
 * Priority: GIT_SHA > VERCEL_GIT_COMMIT_SHA > NEXT_PUBLIC_COMMIT_SHA > "dev".
 */
export function getCommitSha(): string {
  const fullSha =
    process.env.GIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    "";

  if (!fullSha || fullSha === "dev") {
    return "dev";
  }

  return fullSha.slice(0, 7);
}
