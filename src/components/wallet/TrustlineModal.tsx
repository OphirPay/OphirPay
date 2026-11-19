"use client";
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { AssetInfo } from "@/lib/assets";
import { createTrustline } from "@/lib/stellar-transactions";
import type { TrustlineInfo, TrustlineState } from "@/lib/trustline";

/**
 * Extra XLM an account must hold per trustline (the base reserve). Surfaced in
 * the dialog because "create a trustline" fails with an opaque
 * `op_underfunded` when the account cannot cover it.
 */
export const TRUSTLINE_RESERVE_XLM = "0.5";

export interface TrustlineModalProps {
  open: boolean;
  onClose: () => void;
  /** Connected wallet account; the trustline is created *for* this account. */
  publicKey: string | null;
  /** The non-native asset the user tried to receive/send. */
  asset: AssetInfo | null;
  /**
   * Fired once the trustline is confirmed on-chain, so the caller can refresh
   * balances and re-render without a page reload. Receives the verified
   * state read back from Horizon so the caller does not repeat the lookup.
   */
  onCreated?: (asset: AssetInfo, info: TrustlineInfo) => void | Promise<void>;
}

/**
 * Quick-action dialog that establishes a Stellar trustline for a non-native
 * asset via the connected wallet extension (issue #1384).
 *
 * The dialog owns the state machine (idle → signing → verified) that used to
 * be inlined in `AssetSelector`, so the wallet prompt, the error surface and
 * the "verified on-chain" step all live in one place and are reused by every
 * entry point that can hit a missing trustline.
 */
export function TrustlineModal({
  open,
  onClose,
  publicKey,
  asset,
  onCreated,
}: TrustlineModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdState, setCreatedState] = useState<TrustlineState | null>(null);

  // Fresh dialog per open / per asset: a previous error or success must never
  // leak into the next asset the user asks to trust.
  const assetKey = asset ? `${asset.code}:${asset.issuer ?? ""}` : "";
  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setError(null);
    setCreatedState(null);
  }, [open, assetKey]);

  if (!asset) return null;

  const handleCreate = async () => {
    if (!publicKey) {
      setError("Connect your wallet before creating a trustline.");
      return;
    }
    if (!asset.issuer) {
      setError(`No issuer is known for ${asset.code}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const info = await createTrustline(publicKey, asset.code, asset.issuer);
      setCreatedState(info.state);
      // The trustline row only appears in Horizon *after* confirmation, so the
      // refreshed balances must be read after this resolves.
      await onCreated?.(asset, info);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Trustline creation failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const succeeded = createdState !== null;
  const needsIssuerApproval =
    createdState === "unauthorized" || createdState === "frozen";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Create ${asset.code} trustline`}
      description={`Allow this account to hold ${asset.code} on Stellar.`}
      size="sm"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Asset</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {asset.code}
            </span>
          </div>
          {asset.issuer && (
            <div className="mt-2 flex items-center justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400">Issuer</span>
              <span
                className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate"
                title={asset.issuer}
              >
                {asset.issuer}
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-4">
            <span className="text-gray-500 dark:text-gray-400">Cost</span>
            <span className="text-gray-700 dark:text-gray-300">
              +{TRUSTLINE_RESERVE_XLM} XLM reserve
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          A trustline holds its own XLM reserve and pays a small network fee. You
          can revoke it later by removing the trustline.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {succeeded && !needsIssuerApproval && (
          <p
            role="status"
            className="text-sm text-green-700 dark:text-green-400"
          >
            {asset.code} is now trusted — you can receive it.
          </p>
        )}
        {needsIssuerApproval && (
          <p
            role="status"
            className="text-sm text-amber-700 dark:text-amber-400"
          >
            The trustline was created, but the issuer has not authorized{" "}
            {asset.code} yet. Contact the issuer to enable transfers.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          {succeeded && !needsIssuerApproval ? (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                loading={submitting}
                disabled={!publicKey}
              >
                {submitting ? "Waiting for wallet…" : "Create trustline"}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
