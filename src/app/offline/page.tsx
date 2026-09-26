"use client";
// SPDX-License-Identifier: MIT

import Link from "next/link";
import { useEffect, useState } from "react";

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      window.location.reload();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-4 text-center">
      <div className="p-4 rounded-full bg-amber-500/10 text-amber-500 mb-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-12 h-12"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3l18 18M8.5 8.5a7.5 7.5 0 0110.6 0M6.3 6.3a10.5 10.5 0 0114.85 0M10.7 10.7a4.5 4.5 0 014.24 0M12 18.75a.75.75 0 100-1.5.75.75 0 000 1.5z"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        You're Offline
      </h1>
      <p className="text-gray-600 dark:text-gray-400 max-w-md mb-6">
        OphirPay requires an internet connection to process payments, submit transactions, and sync Stellar ledger data. Cached pages and offline data remain accessible.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-ophir-600 text-white rounded-lg hover:bg-ophir-700 transition font-medium"
        >
          Retry Connection
        </button>
        <Link
          href="/"
          className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition font-medium"
        >
          Go to Dashboard
        </Link>
      </div>
      {!isOnline && (
        <p className="mt-4 text-xs text-amber-500 font-medium">
          Waiting for network connection to restore...
        </p>
      )}
    </div>
  );
}
