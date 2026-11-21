// SPDX-License-Identifier: MIT

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Icon rendered inside the primary action button. Defaults to a plus icon. */
  actionIcon?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-gray-900 rounded-xl border border-gray-300 dark:border-gray-700 p-12 text-center",
        className
      )}
    >
      <div className="h-16 w-16 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-6 max-w-md mx-auto">
        {description}
      </p>
      {onAction && (
        <Button
          onClick={onAction}
          leftIcon={
            actionIcon ?? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            )
          }
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
