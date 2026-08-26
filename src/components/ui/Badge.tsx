"use client";
// SPDX-License-Identifier: MIT


import { type ReactNode } from "react";
import { cn, getStatusColor } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "pending";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}

// Light-mode text uses the -800 shade so the badge text meets WCAG AA
// (≥4.5:1 contrast) against the -100 tinted backgrounds. The previous -700
// shades fell below 4.5:1 for several variants (notably warning/green).
const variantClasses: Record<BadgeVariant, string> = {
  default:
    "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300",
  success:
    "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400",
  warning:
    "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400",
  danger: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400",
  info: "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400",
  pending:
    "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400",
};

const dotClasses: Record<BadgeVariant, string> = {
  default: "bg-gray-400",
  success: "bg-green-500",
  warning: "bg-yellow-500",
  danger: "bg-red-500",
  info: "bg-blue-500",
  pending: "bg-purple-500",
};

/** Small pill badge for tags, statuses and labels. */
export function Badge({
  children,
  variant = "default",
  dot = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
        variantClasses[variant],
        className
      )}
    >
      {dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[variant])} />
      )}
      {children}
    </span>
  );
}

/** Status badge that derives its colors from a payment/batch status string. */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const colors = getStatusColor(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
        colors.bg,
        colors.text,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
      {status.replace(/_/g, " ")}
    </span>
  );
}
