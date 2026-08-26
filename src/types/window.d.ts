// SPDX-License-Identifier: MIT

import type { FreighterAPI } from "@/types";

declare global {
  interface Window {
    freighter?: FreighterAPI;
  }

  // Augment Navigator for clipboard and connectivity APIs
  interface Navigator {
    clipboard: Clipboard;
  }
}

export {};
