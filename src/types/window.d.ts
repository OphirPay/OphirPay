// SPDX-License-Identifier: MIT

import type { FreighterAPI } from "@/types";

declare global {
  interface Window {
    freighter?: FreighterAPI;
    gtag?: (command: string, ...args: unknown[]) => void;
    __NEXT_DATA__?: {
      buildId?: string;
      [key: string]: unknown;
    };
  }

  // Augment Navigator for clipboard and connectivity APIs
  interface Navigator {
    clipboard: Clipboard;
  }
}

export {};
