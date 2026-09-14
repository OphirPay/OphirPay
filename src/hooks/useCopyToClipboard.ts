"use client";
// SPDX-License-Identifier: MIT


import { useState, useCallback } from "react";

interface CopyState {
  copied: boolean;
  error: string | null;
}

/**
 * Copy text to clipboard with feedback state.
 * Returns a function to trigger copy and the current state
 * ({ copied, error }) that automatically clears after `resetDelay` ms.
 *
 * @example
 * Add a copy button for a Stellar transaction hash with a visual cue:
 *
 * ```tsx
 * function CopyHashButton({ txHash }: { txHash: string }) {
 *   const { copy, state } = useCopyToClipboard();
 *
 *   return (
 *     <button onClick={() => copy(txHash)} aria-label="Copy transaction hash">
 *       {state.copied ? "Copied!" : "Copy hash"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useCopyToClipboard(resetDelay = 2000): {
  copy: (text: string) => Promise<boolean>;
  state: CopyState;
} {
  const [state, setState] = useState<CopyState>({ copied: false, error: null });

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setState({ copied: true, error: null });
        setTimeout(() => setState({ copied: false, error: null }), resetDelay);
        return true;
      } catch (err) {
        setState({
          copied: false,
          error: err instanceof Error ? err.message : "Failed to copy",
        });
        return false;
      }
    },
    [resetDelay]
  );

  return { copy, state };
}
