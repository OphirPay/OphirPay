// SPDX-License-Identifier: MIT

/**
 * Utility to merge Tailwind classes safely
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(" ");
}

/**
 * Format a Stellar address for display (GXXXX...XXXX)
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

/**
 * Format a number as XLM/USDC amount
 */
export function formatAmount(amount: number, assetCode = "XLM"): string {
  return `${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  })} ${assetCode}`;
}

/**
 * Format a date string for display
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Get relative time string
 */
export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

/**
 * Status badge colors
 */
export function getStatusColor(
  status: string
): { bg: string; text: string; dot: string } {
  switch (status) {
    case "COMPLETED":
    case "PAID":
      return {
        bg: "bg-green-50 dark:bg-green-950/30",
        text: "text-green-800 dark:text-green-400",
        dot: "bg-green-500",
      };
    case "PENDING":
    case "PROCESSING":
    case "CREATED":
      return {
        bg: "bg-blue-50 dark:bg-blue-950/30",
        text: "text-blue-800 dark:text-blue-400",
        dot: "bg-blue-500",
      };
    case "FAILED":
    case "CANCELLED":
    case "EXPIRED":
      return {
        bg: "bg-red-50 dark:bg-red-950/30",
        text: "text-red-800 dark:text-red-400",
        dot: "bg-red-500",
      };
    default:
      return {
        bg: "bg-gray-50 dark:bg-gray-800",
        text: "text-gray-800 dark:text-gray-400",
        dot: "bg-gray-500",
      };
  }
}
