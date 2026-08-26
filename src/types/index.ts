// SPDX-License-Identifier: MIT

// ── Payment Lifecycle States ──────────────────────────────────

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type BatchStatus =
  | "CREATED"
  | "PROCESSING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED";

export type Frequency =
  | "DAILY"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY";

export type RequestStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";

// ── Wallet / Freighter ────────────────────────────────────────

export interface WalletState {
  connected: boolean;
  publicKey: string | null;
  network: string | null;
  balance: string | null;
  balanceLoading: boolean;
}

export interface FreighterAPI {
  isConnected: () => Promise<boolean>;
  requestAccess: () => Promise<string>;
  getAddress: () => Promise<string>;
  getNetwork: () => Promise<string>;
  getNetworkDetails: () => Promise<{
    network: string;
    networkPassphrase: string;
  }>;
  signTransaction: (
    xdr: string,
    opts?: { network?: string; networkPassphrase?: string }
  ) => Promise<string>;
}

// ── Payment ───────────────────────────────────────────────────

export interface Payment {
  id: string;
  amount: number;
  status: PaymentStatus;
  assetCode: string;
  createdAt: string;
  updatedAt: string;
  assetIssuer?: string;
  description?: string;
  memo?: string;
  transactionHash?: string;
  sourceAccountId?: string;
  destAccountId?: string;
  batchId?: string;
  recurrenceId?: string;
  metadata?: string;
  errorMessage?: string;
  completedAt?: string;
}

export interface CreatePaymentInput {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  memo?: string;
  sourceAccountId: string;
  destAddress: string;
}

// ── Batch ─────────────────────────────────────────────────────

export interface Batch {
  id: string;
  userId: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  description?: string;
  payments?: Payment[];
}

export interface BatchRecipient {
  address: string;
  amount: number;
  assetCode?: string;
  memo?: string;
}

export interface CreateBatchInput {
  name: string;
  description?: string;
  recipients: BatchRecipient[];
  sourceAccountId: string;
}

// ── Recurrence ────────────────────────────────────────────────

export interface Recurrence {
  id: string;
  name: string;
  frequency: Frequency;
  amount: number;
  assetCode: string;
  destAddress: string;
  isActive: boolean;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
  assetIssuer?: string;
  description?: string;
  lastRunAt?: string;
}

export interface CreateRecurrenceInput {
  name: string;
  frequency: Frequency;
  amount: number;
  assetCode?: string;
  destAddress: string;
  description?: string;
  sourceAccountId: string;
}

// ── Payment Request ───────────────────────────────────────────

export interface PaymentRequest {
  id: string;
  amount: number;
  assetCode: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  assetIssuer?: string;
  description?: string;
  recipientAddress?: string;
  transactionHash?: string;
}

// ── Webhook ───────────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret: string;
}

// ── Account ───────────────────────────────────────────────────

export interface StellarAccount {
  id: string;
  publicKey: string;
  name: string;
  isActive: boolean;
}

// ── Analytics ─────────────────────────────────────────────────

export interface PaymentAnalytics {
  totalPayments: number;
  totalVolume: number;
  successfulPayments: number;
  failedPayments: number;
  averageAmount: number;
  volumeByDay: { date: string; volume: number; count: number }[];
}

// ── Treasury ──────────────────────────────────────────────────

export interface TreasuryOverview {
  totalBalance: number;
  accounts: {
    name: string;
    publicKey: string;
    balance: number;
  }[];
  recentPayments: Payment[];
  pendingPayments: number;
  monthlyVolume: number;
}
