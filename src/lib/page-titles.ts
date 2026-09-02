// SPDX-License-Identifier: MIT

/**
 * Page title constants for consistent navigation and SEO.
 *
 * Every route under `src/app` renders its title through `usePageTitle()`
 * (see `src/hooks/usePageTitle.ts`), which mirrors the `"%s | OphirPay"`
 * template declared in `src/app/layout.tsx`. Keep the keys here in sync
 * with the routes so the browser tab and share previews always name the
 * current resource.
 */

export const PAGE_TITLES = {
  HOME: "Treasury Dashboard",
  SEND: "Send Payment",
  PAYMENTS: "Payments",
  BATCHES: "Batch Payments",
  NEW_BATCH: "New Batch Payment",
  RECURRING: "Recurring Payments",
  REQUESTS: "Payment Requests",
  WEBHOOKS: "Webhooks",
  WEBHOOK_DELIVERIES: "Webhook Deliveries",
  CONTRACTS: "Smart Contracts",
  ANALYTICS: "Analytics",
  EVENTS: "Event Stream",
  AUDIT_LOG: "Audit Log",
  HOOKS: "Notification Hooks",
  RBAC: "Access Control (RBAC)",
  FEE_CONFIG: "Fee Configuration",
  REFUNDS: "Refunds",
  TIMELOCK: "Timelock",
  POLICY_VERSIONS: "Policy Versions",
  MULTISIG: "Multisig",
  GOVERNANCE: "Governance",
} as const;

export const PAGE_DESCRIPTIONS = {
  HOME: "Monitor your financial operations and payment activity on Stellar.",
  SEND: "Send XLM on the Stellar network — fast, cheap, and secure.",
  PAYMENTS: "View payment records stored on-chain by the OphirPay Soroban contract.",
  BATCHES: "Process multiple payments in a single Stellar transaction.",
  NEW_BATCH: "Create a new batch of payments to multiple recipients on Stellar.",
  RECURRING: "Schedule recurring payments on Stellar with automated execution.",
  REQUESTS: "Create and manage payment requests — shareable invoice-style links.",
  WEBHOOKS: "Configure webhook endpoints for real-time payment event notifications.",
  WEBHOOK_DELIVERIES: "Monitor webhook delivery status, latency, and redeliver failed payloads.",
  CONTRACTS: "View and interact with the OphirPay Soroban smart contracts.",
  ANALYTICS: "Payment analytics and reporting — volume, success rates, trends.",
  EVENTS: "Real-time payment event stream from the Stellar blockchain.",
  AUDIT_LOG: "Query the on-chain audit log of contract actions.",
  HOOKS: "Register notification hooks that fire on on-chain contract events.",
  RBAC: "Manage role-based access control assignments on the OphirPay contracts.",
  FEE_CONFIG: "View and update on-chain fee configuration for OphirPay services.",
  REFUNDS: "Track refund requests and their lifecycle on-chain.",
  TIMELOCK: "Review and execute timelocked administrative actions.",
  POLICY_VERSIONS: "Review the version history of fee and multisig configuration.",
  MULTISIG: "Configure multisig signers and approve/execute multi-sig payments.",
  GOVERNANCE: "Create proposals and vote on DAO-governed contract actions.",
} as const;
