"use client";
// SPDX-License-Identifier: MIT


import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}

const paddingClasses = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-7",
};

/**
 * Shared card container with optional header (title / subtitle / actions).
 */
export function Card({
  title,
  subtitle,
  actions,
  padding = "md",
  className,
  children,
}: CardProps) {
  const hasHeader = Boolean(title || subtitle || actions);

  return (
    <div
      className={cn(
        "bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800",
        className
      )}
    >
      {hasHeader && (
        <div
          className={cn(
            "flex items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-800/60",
            paddingClasses[padding],
            "pb-4"
          )}
        >
          <div>
            {title && (
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={paddingClasses[padding]}>{children}</div>
    </div>
  );
}
