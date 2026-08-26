"use client";
// SPDX-License-Identifier: MIT


import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
  className?: string;
}

/**
 * Renders a keyboard key in a styled box for shortcut hints.
 * Usage: <Kbd>⌘</Kbd> + <Kbd>K</Kbd>
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center h-5 min-w-[20px] px-1.5",
        "rounded text-[11px] font-mono font-medium leading-none",
        "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
        "border border-gray-300 dark:border-gray-700",
        "shadow-[0_1px_0_rgba(0,0,0,0.1)]",
        className
      )}
    >
      {children}
    </kbd>
  );
}
