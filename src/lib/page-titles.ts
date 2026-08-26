// SPDX-License-Identifier: MIT

/**
 * Page title constants for consistent navigation and SEO.
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
  CONTRACTS: "Smart Contracts",
  ANALYTICS: "Analytics",
  EVENTS: "Event Stream",
} as const;

export const PAGE_DESCRIPTIONS = {
  HOME: "Monitor your financial operations and payment activity on Stellar.",
  SEND: "Send XLM on the Stellar network — fast, cheap, and secure.",
  PAYMENTS: "View payment records stored on-chain by the OphirPay Soroban contract.",
  BATCHES: "Process multiple payments in a single Stellar transaction.",
  RECURRING: "Schedule recurring payments on Stellar with automated execution.",
  REQUESTS: "Create and manage payment requests — shareable invoice-style links.",
  WEBHOOKS: "Configure webhook endpoints for real-time payment event notifications.",
  CONTRACTS: "View and interact with the OphirPay Soroban smart contracts.",
  ANALYTICS: "Payment analytics and reporting — volume, success rates, trends.",
  EVENTS: "Real-time payment event stream from the Stellar blockchain.",
} as const;
