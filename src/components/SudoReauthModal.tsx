"use client";
// SPDX-License-Identifier: MIT

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

/**
 * Sudo-mode re-authentication prompt (issue #1389).
 *
 * Shown when a critical admin action (fee-config change, RBAC grant/revoke)
 * is refused with `403 SUDO_REQUIRED` because the session's last cryptographic
 * verification is older than 15 minutes. "Re-authenticate" triggers a wallet
 * message-signature prompt (Freighter/xBull/Albedo); cancelling aborts the
 * action without performing the on-chain write.
 */
export function SudoReauthModal({
  open,
  onConfirm,
  onCancel,
  busy = false,
  error,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Confirm it's you"
      description="Re-authenticate to continue"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          For your security, this administrative action requires a fresh wallet
          signature. Sign the challenge to confirm it&apos;s you — the
          verification must be newer than 15 minutes.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={onConfirm} loading={busy}>
            Re-authenticate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
