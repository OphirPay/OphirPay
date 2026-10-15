"use client";
// SPDX-License-Identifier: MIT

import { useState, useEffect } from "react";

/**
 * Banner that appears when the browser detects offline status.
 * Uses navigator.onLine and online/offline window events.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);

    if (typeof navigator !== "undefined") {
      setOffline(!navigator.onLine);
    }

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="alert"
      data-testid="offline-banner"
      aria-live="polite"
      className="sticky top-0 z-50 w-full bg-amber-500 text-white text-center py-2 text-sm font-medium shadow-sm transition-all duration-200"
    >
      <div className="flex items-center justify-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
        <span>Offline - displaying cached data</span>
      </div>
    </div>
  );
}
