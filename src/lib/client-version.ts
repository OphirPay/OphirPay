// SPDX-License-Identifier: MIT

/**
 * Client-side version tracking and cache-busting.
 * Reads the build ID from Next.js and exposes it for service workers and analytics.
 */

/** Get the build ID from the Next.js data or a known meta tag. */
export function getBuildId(): string {
  if (typeof window === "undefined") return "ssr";

  // Next.js injects __NEXT_DATA__ with the buildId
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (window as any).__NEXT_DATA__;
    if (data?.buildId) return data.buildId as string;
  } catch {
    // Not a Next.js runtime
  }

  // Fallback: read from meta tag if set
  const meta = document.querySelector('meta[name="build-id"]');
  if (meta) return meta.getAttribute("content") || "unknown";

  return "unknown";
}

/** Get the app version from package.json or env. */
export function getAppVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
}

/** Check if the deployed version differs from what the user has cached. */
export function checkVersionMismatch(): boolean {
  const stored = localStorage.getItem("ophirpay-version");
  const current = getAppVersion();

  if (stored !== current) {
    localStorage.setItem("ophirpay-version", current);
    return true;
  }

  return false;
}
