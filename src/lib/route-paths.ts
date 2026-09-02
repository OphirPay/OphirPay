// SPDX-License-Identifier: MIT

/** Centralized route path constants — prevents hardcoding URLs across the app. */
export const ROUTES = {
  HOME: "/",
  SEND: "/send",
  PAYMENTS: "/payments",
  BATCHES: "/batches",
  NEW_BATCH: "/batches/new",
  RECURRING: "/recurring",
  REQUESTS: "/requests",
  WEBHOOKS: "/webhooks",
  CONTRACTS: "/contracts",
  ANALYTICS: "/analytics",
  EVENTS: "/events",
  MULTISIG: "/multisig",
  GOVERNANCE: "/governance",
  RBAC: "/rbac",
  KEYS: "/keys",
  FEE_CONFIG: "/fee-config",
  TIMELOCK: "/timelock",
  POLICY_VERSIONS: "/policy-versions",
  REFUNDS: "/refunds",
  HOOKS: "/hooks",
  AUDIT_LOG: "/audit-log",
} as const;

/** API route paths */
export const API_ROUTES = {
  HEALTH: "/api/health",
  PAYMENTS: "/api/payments",
  BATCHES: "/api/batches",
  WEBHOOKS: "/api/webhooks",
  WEBHOOK_REPLAY: "/api/webhooks", // append /[id]/replay
  WEBHOOK_DELIVERIES: "/api/webhooks", // append /[id]/deliveries
  ANALYTICS: "/api/analytics",
  REQUESTS: "/api/requests",
  RECURRING: "/api/recurring",
  KEYS: "/api/keys",
  EVENTS: "/api/events",
  EVENTS_HISTORY: "/api/events/history",
  RBAC: "/api/rbac",
  FEE_CONFIG: "/api/fee-config",
  FEE_CONFIG_HISTORY: "/api/fee-config/history",
  TIMELOCK: "/api/timelock",
  POLICY_VERSIONS: "/api/policy-versions",
  MULTISIG: "/api/multisig",
  MULTISIG_REQUESTS: "/api/multisig/requests",
  GOVERNANCE: "/api/governance",
  GOVERNANCE_PROPOSALS: "/api/governance/proposals",
  GOVERNANCE_VOTE: "/api/governance/vote",
  GOVERNANCE_EXECUTE: "/api/governance/execute",
} as const;
