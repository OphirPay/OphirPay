// SPDX-License-Identifier: MIT

import type {
  Sep24AnchorConfig,
  Sep24InteractiveParams,
  Sep24InteractiveResponse,
  Sep24Transaction,
  Sep24TransactionStatus,
} from "./types";

/**
 * Terminal statuses that signify the end of a SEP-24 transaction lifecycle.
 */
export const TERMINAL_STATUSES: readonly Sep24TransactionStatus[] = [
  "completed",
  "refunded",
  "expired",
  "no_market",
  "too_small",
  "too_large",
  "error",
] as const;

/**
 * Initiate an interactive deposit with a SEP-24 anchor.
 *
 * @param config Anchor discovery configuration
 * @param params Interactive deposit parameters
 * @returns Object containing the interactive URL and transaction ID
 */
export async function initiateInteractiveDeposit(
  config: Sep24AnchorConfig,
  params: Sep24InteractiveParams
): Promise<Sep24InteractiveResponse> {
  const url = `${config.transferServerSep24}/transactions/deposit/interactive`;

  const formData = new URLSearchParams();
  formData.set("asset_code", params.assetCode);
  formData.set("account", params.account);
  if (params.amount !== undefined && params.amount > 0) {
    formData.set("amount", String(params.amount));
  }
  if (params.claimableBalanceSupported !== undefined) {
    formData.set("claimable_balance_supported", String(params.claimableBalanceSupported));
  }
  if (params.memo) {
    formData.set("memo", params.memo);
    formData.set("memo_type", params.memoType || "text");
  }
  if (params.lang) {
    formData.set("lang", params.lang);
  }
  if (params.walletName) {
    formData.set("wallet_name", params.walletName);
  }
  if (params.walletUrl) {
    formData.set("wallet_url", params.walletUrl);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(10000),
  });

  const body = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const errorMsg = (body.error as string) || (body.message as string) || `Anchor error HTTP ${res.status}`;
    throw new Error(`Deposit initiation failed: ${errorMsg}`);
  }

  if (!body.url || !body.id) {
    throw new Error("Anchor response missing required interactive url or transaction id");
  }

  return {
    type: (body.type as "interactive_customer_info_needed") || "interactive_customer_info_needed",
    id: String(body.id),
    url: String(body.url),
  };
}

/**
 * Initiate an interactive withdrawal with a SEP-24 anchor.
 *
 * @param config Anchor discovery configuration
 * @param params Interactive withdrawal parameters
 * @returns Object containing the interactive URL and transaction ID
 */
export async function initiateInteractiveWithdrawal(
  config: Sep24AnchorConfig,
  params: Sep24InteractiveParams
): Promise<Sep24InteractiveResponse> {
  const url = `${config.transferServerSep24}/transactions/withdraw/interactive`;

  const formData = new URLSearchParams();
  formData.set("asset_code", params.assetCode);
  formData.set("account", params.account);
  if (params.amount !== undefined && params.amount > 0) {
    formData.set("amount", String(params.amount));
  }
  if (params.memo) {
    formData.set("memo", params.memo);
    formData.set("memo_type", params.memoType || "text");
  }
  if (params.lang) {
    formData.set("lang", params.lang);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(10000),
  });

  const body = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const errorMsg = (body.error as string) || (body.message as string) || `Anchor error HTTP ${res.status}`;
    throw new Error(`Withdrawal initiation failed: ${errorMsg}`);
  }

  if (!body.url || !body.id) {
    throw new Error("Anchor response missing required interactive url or transaction id");
  }

  return {
    type: (body.type as "interactive_customer_info_needed") || "interactive_customer_info_needed",
    id: String(body.id),
    url: String(body.url),
  };
}

/**
 * Retrieve transaction details and current status from the anchor.
 */
export async function getAnchorTransaction(
  config: Sep24AnchorConfig,
  transactionId: string
): Promise<Sep24Transaction> {
  const url = `${config.transferServerSep24}/transaction?id=${encodeURIComponent(transactionId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  const data = (await res.json()) as { transaction?: Record<string, unknown> };

  if (!res.ok || !data.transaction) {
    throw new Error(`Failed to fetch anchor transaction ${transactionId} (HTTP ${res.status})`);
  }

  const t = data.transaction;
  return {
    id: String(t.id),
    kind: (t.kind as "deposit" | "withdrawal") || "deposit",
    status: (t.status as Sep24TransactionStatus) || "incomplete",
    statusEta: typeof t.status_eta === "number" ? t.status_eta : undefined,
    amountIn: typeof t.amount_in === "string" ? t.amount_in : undefined,
    amountOut: typeof t.amount_out === "string" ? t.amount_out : undefined,
    amountFee: typeof t.amount_fee === "string" ? t.amount_fee : undefined,
    stellarTransactionId: typeof t.stellar_transaction_id === "string" ? t.stellar_transaction_id : undefined,
    externalTransactionId: typeof t.external_transaction_id === "string" ? t.external_transaction_id : undefined,
    message: typeof t.message === "string" ? t.message : undefined,
    refunded: t.refunded === true,
    moreInfoUrl: typeof t.more_info_url === "string" ? t.more_info_url : undefined,
    from: typeof t.from === "string" ? t.from : undefined,
    to: typeof t.to === "string" ? t.to : undefined,
    startedAt: typeof t.started_at === "string" ? t.started_at : undefined,
    completedAt: typeof t.completed_at === "string" ? t.completed_at : undefined,
  };
}

/**
 * Poll anchor transaction status until it reaches a terminal status or exceeds max wait time.
 */
export async function pollTransactionStatus(
  config: Sep24AnchorConfig,
  transactionId: string,
  options: {
    maxWaitMs?: number;
    intervalMs?: number;
    onProgress?: (tx: Sep24Transaction) => void;
  } = {}
): Promise<Sep24Transaction> {
  const maxWaitMs = options.maxWaitMs ?? 60000;
  const intervalMs = options.intervalMs ?? 3000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const tx = await getAnchorTransaction(config, transactionId);
    if (options.onProgress) {
      options.onProgress(tx);
    }

    if (TERMINAL_STATUSES.includes(tx.status)) {
      return tx;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // Final check upon deadline
  return getAnchorTransaction(config, transactionId);
}
