// SPDX-License-Identifier: MIT

/**
 * Network status detection and display helpers.
 */

/** Get the configured Stellar network name with active dot color. */
export function getNetworkStatus(network: string): {
  label: string;
  color: string;
  bgColor: string;
  dotClass: string;
} {
  if (network === "PUBLIC" || network === "MAINNET") {
    return {
      label: "Mainnet",
      color: "text-red-700 dark:text-red-400",
      bgColor: "bg-red-50 dark:bg-red-950/30",
      dotClass: "bg-red-500",
    };
  }
  return {
    label: "Testnet",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    dotClass: "bg-green-500",
  };
}

/** Warn if the user is about to send on mainnet (production safety check). */
export function isMainnet(network: string): boolean {
  return network === "PUBLIC" || network === "MAINNET";
}
