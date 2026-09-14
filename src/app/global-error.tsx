"use client";
// SPDX-License-Identifier: MIT


import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { reportRenderedError } from "@/lib/analytics-events";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Global error boundary caught:", error);
    reportRenderedError(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md px-6">
          <h1 className="text-4xl font-bold mb-4">Something went wrong</h1>
          <p className="text-slate-400 mb-6">
            An unexpected error occurred. Please try again or contact support if
            the problem persists.
          </p>
          {error.digest && (
            <p className="text-xs text-slate-600 mb-6 font-mono">
              Error ID: {error.digest}
            </p>
          )}
          <Button onClick={reset}>Try again</Button>
        </div>
      </body>
    </html>
  );
}
