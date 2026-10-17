"use client";
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from "react";
import { SudoReauthModal } from "@/components/SudoReauthModal";
import { getActiveWalletConnector } from "@/lib/wallets";
import type { SudoChallengeDetails } from "@/lib/sudo-client";

/**
 * Wires the sudo-mode re-authentication prompt into an admin page
 * (issue #1389).
 *
 * Returns:
 *   • `requestReauth` — pass to `authorizeAdminAction`; opens the modal and
 *     resolves once the user approves or cancels.
 *   • `signMessage`   — signs the server challenge with the active wallet.
 *     Throws for wallets without message-signing support so the caller can
 *     surface a clear error instead of silently proceeding.
 *   • `modal`         — render this once in the page.
 *
 * @example
 * ```tsx
 * const sudo = useAdminSudo();
 * await authorizeAdminAction("/api/rbac", body, {
 *   signMessage: sudo.signMessage,
 *   requestReauth: sudo.requestReauth,
 * });
 * // …then perform the wallet-signed on-chain write
 * ```
 */
export function useAdminSudo() {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((approved: boolean) => void) | null>(null);

  const requestReauth = useCallback(
    (_details: SudoChallengeDetails): Promise<boolean> => {
      setOpen(true);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    []
  );

  const settle = useCallback((approved: boolean) => {
    setOpen(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(approved);
  }, []);

  const signMessage = useCallback(async (message: string): Promise<string> => {
    const connector = getActiveWalletConnector();
    if (!connector?.signMessage) {
      throw new Error(
        "This wallet cannot sign messages. Reconnect with Freighter, xBull or Albedo to re-authenticate."
      );
    }
    return connector.signMessage(message);
  }, []);

  const modal = (
    <SudoReauthModal
      open={open}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { requestReauth, signMessage, modal };
}
