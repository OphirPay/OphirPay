"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/**
 * Sudo-mode re-authentication prompt (issue #1389, #1907).
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
  sessionTtlMs,
  onSessionExpire,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
  /**
   * Remaining lifetime of the active sudo session in ms (15 minutes after a
   * fresh verification). When set, a countdown ticks every second while the
   * modal is open and `onSessionExpire` fires once it reaches zero.
   */
  sessionTtlMs?: number;
  onSessionExpire?: () => void;
}) {
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const onSessionExpireRef = useRef(onSessionExpire);

  useEffect(() => {
    onSessionExpireRef.current = onSessionExpire;
  }, [onSessionExpire]);

  // Countdown: restarts whenever the modal opens or the TTL changes, and is
  // cleared (reset) when it closes.
  useEffect(() => {
    if (!open || sessionTtlMs === undefined) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(Math.max(0, Math.ceil(sessionTtlMs / 1000)));
    const id = setInterval(() => {
      setRemainingSeconds((prev) => (prev === null || prev <= 0 ? prev : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [open, sessionTtlMs]);

  useEffect(() => {
    if (remainingSeconds === 0) onSessionExpireRef.current?.();
  }, [remainingSeconds]);

  useEffect(() => {
    if (open) {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        triggerElementRef.current = document.activeElement;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onCancel();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }

    if (triggerElementRef.current && typeof triggerElementRef.current.focus === "function") {
      triggerElementRef.current.focus();
      triggerElementRef.current = null;
    }
  }, [open, busy, onCancel]);

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
        {remainingSeconds !== null && (
          <p role="timer" data-testid="sudo-countdown" className="text-sm font-mono">
            {remainingSeconds === 0
              ? "Sudo session expired"
              : `Sudo session expires in ${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`}
          </p>
        )}
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
