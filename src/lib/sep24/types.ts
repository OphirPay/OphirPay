// SPDX-License-Identifier: MIT

/**
 * Standard SEP-24 transaction lifecycle states as defined by the Stellar SEP-24 specification.
 */
export type Sep24TransactionStatus =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_external"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "completed"
  | "refunded"
  | "expired"
  | "no_market"
  | "too_small"
  | "too_large"
  | "error";

/**
 * Asset-specific rules and limits advertised by the anchor /info endpoint.
 */
export interface Sep24AssetRule {
  enabled: boolean;
  minAmount?: number;
  maxAmount?: number;
  feeFixed?: number;
  feePercent?: number;
  feeMinimum?: number;
}

/**
 * Information for an asset supported by a SEP-24 anchor.
 */
export interface Sep24AssetInfo {
  code: string;
  issuer?: string;
  deposit: Sep24AssetRule;
  withdraw: Sep24AssetRule;
}

/**
 * Configuration discovered from an anchor's SEP-1 stellar.toml and /info endpoint.
 */
export interface Sep24AnchorConfig {
  domain: string;
  transferServerSep24: string;
  webAuthEndpoint?: string;
  signingKey?: string;
  orgName?: string;
  assets: Record<string, Sep24AssetInfo>;
}

/**
 * Payload parameters for initiating a SEP-24 interactive deposit or withdrawal.
 */
export interface Sep24InteractiveParams {
  assetCode: string;
  account: string;
  amount?: number;
  claimableBalanceSupported?: boolean;
  lang?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash";
  walletName?: string;
  walletUrl?: string;
}

/**
 * Response returned by anchor POST /transactions/(deposit|withdraw)/interactive.
 */
export interface Sep24InteractiveResponse {
  type: "interactive_customer_info_needed" | "non_interactive_customer_info_needed";
  id: string;
  url: string;
}

/**
 * SEP-24 transaction record returned by anchor GET /transaction?id=...
 */
export interface Sep24Transaction {
  id: string;
  kind: "deposit" | "withdrawal";
  status: Sep24TransactionStatus;
  statusEta?: number;
  amountIn?: string;
  amountOut?: string;
  amountFee?: string;
  stellarTransactionId?: string;
  externalTransactionId?: string;
  message?: string;
  refunded?: boolean;
  moreInfoUrl?: string;
  from?: string;
  to?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Result of initiating a fiat on/off-ramp flow through the OphirPay API.
 */
export interface FiatFlowResult {
  transactionId: string;
  interactiveUrl: string;
  kind: "deposit" | "withdrawal";
  assetCode: string;
  anchorDomain: string;
  status: Sep24TransactionStatus;
}
