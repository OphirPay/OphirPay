"use client";
// SPDX-License-Identifier: MIT


import { useState, useEffect } from "react";

/**
 * Banner that appears when the browser detects offline status.
 * Uses navigator.onLine and online/offline events.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);

    setOffline(!navigator.onLine);

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="sticky top-0 z-50 w-full bg-amber-500 text-white text-center py-2 text-sm font-medium">
      You are offline — some features may be unavailable.
    </div>
  );
}
