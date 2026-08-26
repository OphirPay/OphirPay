// SPDX-License-Identifier: MIT

/**
 * Browser compatibility detection.
 * Shows warnings for unsupported browsers or missing features.
 */

interface BrowserInfo {
  name: string;
  version: string;
  isSupported: boolean;
  missingFeatures: string[];
}

/**
 * Check if the current browser supports all required features for OphirPay.
 * Required: Web Crypto API, Clipboard API, Fetch, Blob URL, ES2020+
 */
export function checkBrowserSupport(): BrowserInfo {
  const missing: string[] = [];

  if (typeof crypto === "undefined" || !crypto.subtle) {
    missing.push("Web Crypto API");
  }
  if (typeof ClipboardItem === "undefined") {
    missing.push("Clipboard API");
  }
  if (typeof fetch === "undefined") {
    missing.push("Fetch API");
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL === "undefined") {
    missing.push("Blob URL API");
  }

  return {
    name: getBrowserName(),
    version: getBrowserVersion(),
    isSupported: missing.length === 0,
    missingFeatures: missing,
  };
}

function getBrowserName(): string {
  if (typeof navigator === "undefined") return "Unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edg")) return "Edge";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  return "Unknown";
}

function getBrowserVersion(): string {
  if (typeof navigator === "undefined") return "0";
  const ua = navigator.userAgent;
  const match = ua.match(/(Firefox|Chrome|Safari|Edg)\/(\d+)/);
  return match ? match[2] : "0";
}
