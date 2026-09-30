// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate
//
// 95 operations extracted from the committed OpenAPI spec.

/** @typedef {{ name: string, method: string, path: string, summary: string, tags: string[], requestBody: boolean }} ApiOperation */

/** @type {ReadonlyArray<ApiOperation>} */
export const API_OPERATIONS = [
  {
    "name": "deleteApiAuthSession",
    "method": "DELETE",
    "path": "/api/auth/session",
    "summary": "Revoke the session cookie",
    "tags": [
      "Session"
    ],
    "requestBody": false
  },
  {
    "name": "deleteApiKeys",
    "method": "DELETE",
    "path": "/api/keys",
    "summary": "Revoke an API key",
    "tags": [
      "API Keys"
    ],
    "requestBody": false
  },
  {
    "name": "deleteApiPaymentsId",
    "method": "DELETE",
    "path": "/api/payments/{id}",
    "summary": "Soft-delete a payment",
    "tags": [
      "Payments"
    ],
    "requestBody": false
  },
  {
    "name": "deleteApiScheduled",
    "method": "DELETE",
    "path": "/api/scheduled",
    "summary": "Cancel a scheduled payment that has not executed",
    "tags": [
      "Scheduled Payments"
    ],
    "requestBody": false
  },
  {
    "name": "deleteApiWebhooks",
    "method": "DELETE",
    "path": "/api/webhooks",
    "summary": "Delete a webhook",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "getApiAnalytics",
    "method": "GET",
    "path": "/api/analytics",
    "summary": "Aggregated payment analytics",
    "tags": [
      "Analytics"
    ],
    "requestBody": false
  },
  {
    "name": "getApiAssetsMetadata",
    "method": "GET",
    "path": "/api/assets/metadata",
    "summary": "Resolve asset metadata from the issuer's SEP-1 TOML",
    "tags": [
      "Assets"
    ],
    "requestBody": false
  },
  {
    "name": "getApiAuditLog",
    "method": "GET",
    "path": "/api/audit-log",
    "summary": "Query contract audit log",
    "tags": [
      "Audit Log"
    ],
    "requestBody": false
  },
  {
    "name": "getApiAuditLogExport",
    "method": "GET",
    "path": "/api/audit-log/export",
    "summary": "Export contract audit log to CSV",
    "tags": [
      "Audit Log"
    ],
    "requestBody": false
  },
  {
    "name": "getApiAuditLogSse",
    "method": "GET",
    "path": "/api/audit-log/sse",
    "summary": "Subscribe to the live audit-log stream",
    "tags": [
      "Audit Log"
    ],
    "requestBody": false
  },
  {
    "name": "getApiAuthChallenge",
    "method": "GET",
    "path": "/api/auth/challenge",
    "summary": "Mint a proof-of-ownership challenge for a wallet",
    "tags": [
      "Session"
    ],
    "requestBody": false
  },
  {
    "name": "getApiBatches",
    "method": "GET",
    "path": "/api/batches",
    "summary": "List batches with pagination",
    "tags": [
      "Batches"
    ],
    "requestBody": false
  },
  {
    "name": "getApiBatchesId",
    "method": "GET",
    "path": "/api/batches/{id}",
    "summary": "Get a batch with its child payments",
    "tags": [
      "Batches"
    ],
    "requestBody": false
  },
  {
    "name": "getApiBatchesSummary",
    "method": "GET",
    "path": "/api/batches/summary",
    "summary": "Batch status summary for the authenticated user",
    "tags": [
      "Batches"
    ],
    "requestBody": false
  },
  {
    "name": "getApiContracts",
    "method": "GET",
    "path": "/api/contracts",
    "summary": "Get contract deployment info and version",
    "tags": [
      "Contracts"
    ],
    "requestBody": false
  },
  {
    "name": "getApiCron",
    "method": "GET",
    "path": "/api/cron",
    "summary": "Scheduled-payment execution sweep (Vercel Cron ping)",
    "tags": [
      "Jobs & Cron"
    ],
    "requestBody": false
  },
  {
    "name": "getApiCsrf",
    "method": "GET",
    "path": "/api/csrf",
    "summary": "Mint a CSRF token for this session",
    "tags": [
      "Session"
    ],
    "requestBody": false
  },
  {
    "name": "getApiEscrows",
    "method": "GET",
    "path": "/api/escrows",
    "summary": "List escrows or fetch one by id",
    "tags": [
      "Escrows"
    ],
    "requestBody": false
  },
  {
    "name": "getApiEscrowsId",
    "method": "GET",
    "path": "/api/escrows/{id}",
    "summary": "Get an escrow by id",
    "tags": [
      "Escrows"
    ],
    "requestBody": false
  },
  {
    "name": "getApiEvents",
    "method": "GET",
    "path": "/api/events",
    "summary": "Subscribe to real-time payment events",
    "tags": [
      "Events"
    ],
    "requestBody": false
  },
  {
    "name": "getApiEventsHistory",
    "method": "GET",
    "path": "/api/events/history",
    "summary": "Fetch on-chain payment event history (cursor paginated)",
    "tags": [
      "Events"
    ],
    "requestBody": false
  },
  {
    "name": "getApiFeeConfig",
    "method": "GET",
    "path": "/api/fee-config",
    "summary": "Get the current fee configuration",
    "tags": [
      "Fee Config"
    ],
    "requestBody": false
  },
  {
    "name": "getApiFeeConfigCollector",
    "method": "GET",
    "path": "/api/fee-config/collector",
    "summary": "Get the fee collector address",
    "tags": [
      "Fee Config"
    ],
    "requestBody": false
  },
  {
    "name": "getApiFeeConfigHistory",
    "method": "GET",
    "path": "/api/fee-config/history",
    "summary": "Get fee configuration version history",
    "tags": [
      "Fee Config"
    ],
    "requestBody": false
  },
  {
    "name": "getApiGovernanceProposals",
    "method": "GET",
    "path": "/api/governance/proposals",
    "summary": "List governance proposals (most recent first)",
    "tags": [
      "Governance"
    ],
    "requestBody": false
  },
  {
    "name": "getApiGovernanceProposalsId",
    "method": "GET",
    "path": "/api/governance/proposals/{id}",
    "summary": "Fetch one governance proposal with its vote history",
    "tags": [
      "Governance"
    ],
    "requestBody": false
  },
  {
    "name": "getApiHealth",
    "method": "GET",
    "path": "/api/health",
    "summary": "Service health check",
    "tags": [
      "Health"
    ],
    "requestBody": false
  },
  {
    "name": "getApiHealthLive",
    "method": "GET",
    "path": "/api/health/live",
    "summary": "Liveness probe (process only)",
    "tags": [
      "Health"
    ],
    "requestBody": false
  },
  {
    "name": "getApiHooks",
    "method": "GET",
    "path": "/api/hooks",
    "summary": "List notification hooks",
    "tags": [
      "Hooks"
    ],
    "requestBody": false
  },
  {
    "name": "getApiKeys",
    "method": "GET",
    "path": "/api/keys",
    "summary": "List API keys (hashes hidden)",
    "tags": [
      "API Keys"
    ],
    "requestBody": false
  },
  {
    "name": "getApiKeysStats",
    "method": "GET",
    "path": "/api/keys/stats",
    "summary": "API key usage statistics",
    "tags": [
      "API Keys"
    ],
    "requestBody": false
  },
  {
    "name": "getApiMetrics",
    "method": "GET",
    "path": "/api/metrics",
    "summary": "Prometheus metrics endpoint",
    "tags": [
      "Metrics"
    ],
    "requestBody": false
  },
  {
    "name": "getApiMultisig",
    "method": "GET",
    "path": "/api/multisig",
    "summary": "Get current multisig configuration",
    "tags": [
      "Multisig"
    ],
    "requestBody": false
  },
  {
    "name": "getApiMultisigRequests",
    "method": "GET",
    "path": "/api/multisig/requests",
    "summary": "List pending approval requests",
    "tags": [
      "Multisig"
    ],
    "requestBody": false
  },
  {
    "name": "getApiPauseState",
    "method": "GET",
    "path": "/api/pause-state",
    "summary": "Contract pause state",
    "tags": [
      "Contracts"
    ],
    "requestBody": false
  },
  {
    "name": "getApiPayments",
    "method": "GET",
    "path": "/api/payments",
    "summary": "List payments",
    "tags": [
      "Payments"
    ],
    "requestBody": false
  },
  {
    "name": "getApiPaymentsExport",
    "method": "GET",
    "path": "/api/payments/export",
    "summary": "Export payments as CSV",
    "tags": [
      "Payments"
    ],
    "requestBody": false
  },
  {
    "name": "getApiPaymentsId",
    "method": "GET",
    "path": "/api/payments/{id}",
    "summary": "Get a payment by ID",
    "tags": [
      "Payments"
    ],
    "requestBody": false
  },
  {
    "name": "getApiPolicyVersions",
    "method": "GET",
    "path": "/api/policy-versions",
    "summary": "Get fee and multisig config version history",
    "tags": [
      "Policy Versions"
    ],
    "requestBody": false
  },
  {
    "name": "getApiRbac",
    "method": "GET",
    "path": "/api/rbac",
    "summary": "Look up role assignments",
    "tags": [
      "RBAC"
    ],
    "requestBody": false
  },
  {
    "name": "getApiRecurring",
    "method": "GET",
    "path": "/api/recurring",
    "summary": "List recurring payments",
    "tags": [
      "Recurring"
    ],
    "requestBody": false
  },
  {
    "name": "getApiRecurringId",
    "method": "GET",
    "path": "/api/recurring/{id}",
    "summary": "Get a recurring payment by id",
    "tags": [
      "Recurring"
    ],
    "requestBody": false
  },
  {
    "name": "getApiRefunds",
    "method": "GET",
    "path": "/api/refunds",
    "summary": "List refunds or refund analytics",
    "tags": [
      "Refunds"
    ],
    "requestBody": false
  },
  {
    "name": "getApiRequests",
    "method": "GET",
    "path": "/api/requests",
    "summary": "List payment requests",
    "tags": [
      "Payment Requests"
    ],
    "requestBody": false
  },
  {
    "name": "getApiRequestsExpire",
    "method": "GET",
    "path": "/api/requests/expire",
    "summary": "Expire overdue payment requests",
    "tags": [
      "Payment Requests"
    ],
    "requestBody": false
  },
  {
    "name": "getApiScheduled",
    "method": "GET",
    "path": "/api/scheduled",
    "summary": "List scheduled payments (soonest first)",
    "tags": [
      "Scheduled Payments"
    ],
    "requestBody": false
  },
  {
    "name": "getApiScheduledRun",
    "method": "GET",
    "path": "/api/scheduled/run",
    "summary": "Trigger the scheduled-payment sweep (cron ping)",
    "tags": [
      "Scheduled Payments"
    ],
    "requestBody": false
  },
  {
    "name": "getApiStats",
    "method": "GET",
    "path": "/api/stats",
    "summary": "Aggregate on-chain contract statistics",
    "tags": [
      "Stats"
    ],
    "requestBody": false
  },
  {
    "name": "getApiStreams",
    "method": "GET",
    "path": "/api/streams",
    "summary": "List streams or fetch one by id",
    "tags": [
      "Streams"
    ],
    "requestBody": false
  },
  {
    "name": "getApiStreamsId",
    "method": "GET",
    "path": "/api/streams/{id}",
    "summary": "Get a stream by id",
    "tags": [
      "Streams"
    ],
    "requestBody": false
  },
  {
    "name": "getApiTimelock",
    "method": "GET",
    "path": "/api/timelock",
    "summary": "List pending timelocked actions",
    "tags": [
      "Timelock"
    ],
    "requestBody": false
  },
  {
    "name": "getApiWebhooks",
    "method": "GET",
    "path": "/api/webhooks",
    "summary": "List registered webhooks (secrets redacted)",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "getApiWebhooksId",
    "method": "GET",
    "path": "/api/webhooks/{id}",
    "summary": "Get a single webhook (secret redacted)",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "getApiWebhooksIdDeliveries",
    "method": "GET",
    "path": "/api/webhooks/{id}/deliveries",
    "summary": "List delivery history for a webhook",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "getApiWebhooksIdDeliveriesDeliveryId",
    "method": "GET",
    "path": "/api/webhooks/{id}/deliveries/{deliveryId}",
    "summary": "Get a webhook delivery record",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "getApiWebhooksIdTest",
    "method": "GET",
    "path": "/api/webhooks/{id}/test",
    "summary": "Preview a signed webhook test request",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "patchApiHooksId",
    "method": "PATCH",
    "path": "/api/hooks/{id}",
    "summary": "Deactivate a hook ledger row after an on-chain unregister_hook",
    "tags": [
      "Hooks"
    ],
    "requestBody": true
  },
  {
    "name": "patchApiKeys",
    "method": "PATCH",
    "path": "/api/keys",
    "summary": "Update the scopes of an existing API key",
    "tags": [
      "API Keys"
    ],
    "requestBody": true
  },
  {
    "name": "patchApiPaymentsId",
    "method": "PATCH",
    "path": "/api/payments/{id}",
    "summary": "Update payment status or metadata",
    "tags": [
      "Payments"
    ],
    "requestBody": true
  },
  {
    "name": "patchApiRecurring",
    "method": "PATCH",
    "path": "/api/recurring",
    "summary": "Pause or resume a recurring payment",
    "tags": [
      "Recurring"
    ],
    "requestBody": true
  },
  {
    "name": "patchApiRecurringId",
    "method": "PATCH",
    "path": "/api/recurring/{id}",
    "summary": "Cancel (deactivate) a recurring payment",
    "tags": [
      "Recurring"
    ],
    "requestBody": false
  },
  {
    "name": "patchApiRefundsId",
    "method": "PATCH",
    "path": "/api/refunds/{id}",
    "summary": "Update the lifecycle status of a refund ledger row",
    "tags": [
      "Refunds"
    ],
    "requestBody": true
  },
  {
    "name": "patchApiWebhooks",
    "method": "PATCH",
    "path": "/api/webhooks",
    "summary": "Rotate a webhook signing secret",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "postApiAuthSession",
    "method": "POST",
    "path": "/api/auth/session",
    "summary": "Issue a signed session cookie for a connected wallet",
    "tags": [
      "Session"
    ],
    "requestBody": true
  },
  {
    "name": "postApiBatches",
    "method": "POST",
    "path": "/api/batches",
    "summary": "Create a batch payment (idempotent)",
    "tags": [
      "Batches"
    ],
    "requestBody": true
  },
  {
    "name": "postApiBatchesId",
    "method": "POST",
    "path": "/api/batches/{id}",
    "summary": "Bulk-cancel a batch's PENDING payments",
    "tags": [
      "Batches"
    ],
    "requestBody": false
  },
  {
    "name": "postApiCron",
    "method": "POST",
    "path": "/api/cron",
    "summary": "Run the scheduled-payment sweep manually",
    "tags": [
      "Jobs & Cron"
    ],
    "requestBody": false
  },
  {
    "name": "postApiCspReport",
    "method": "POST",
    "path": "/api/csp-report",
    "summary": "CSP violation report collector",
    "tags": [
      "Security"
    ],
    "requestBody": true
  },
  {
    "name": "postApiEscrows",
    "method": "POST",
    "path": "/api/escrows",
    "summary": "Create an on-chain escrow",
    "tags": [
      "Escrows"
    ],
    "requestBody": true
  },
  {
    "name": "postApiGovernanceExecute",
    "method": "POST",
    "path": "/api/governance/execute",
    "summary": "Execute a passed proposal",
    "tags": [
      "Governance"
    ],
    "requestBody": true
  },
  {
    "name": "postApiGovernanceProposals",
    "method": "POST",
    "path": "/api/governance/proposals",
    "summary": "Create a governance proposal (on-chain)",
    "tags": [
      "Governance"
    ],
    "requestBody": true
  },
  {
    "name": "postApiGovernanceVote",
    "method": "POST",
    "path": "/api/governance/vote",
    "summary": "Cast a vote on a proposal (on-chain, 1 vote per address)",
    "tags": [
      "Governance"
    ],
    "requestBody": true
  },
  {
    "name": "postApiHooks",
    "method": "POST",
    "path": "/api/hooks",
    "summary": "Persist a hook ledger row after an on-chain register_hook",
    "tags": [
      "Hooks"
    ],
    "requestBody": true
  },
  {
    "name": "postApiJobsProcessDueRecurring",
    "method": "POST",
    "path": "/api/jobs/process-due-recurring",
    "summary": "Claim and execute due recurring schedules",
    "tags": [
      "Jobs & Cron"
    ],
    "requestBody": true
  },
  {
    "name": "postApiKeys",
    "method": "POST",
    "path": "/api/keys",
    "summary": "Generate a new API key (raw key shown once)",
    "tags": [
      "API Keys"
    ],
    "requestBody": true
  },
  {
    "name": "postApiKeysIdRotate",
    "method": "POST",
    "path": "/api/keys/{id}/rotate",
    "summary": "Rotate an API key with a 24-hour overlap",
    "tags": [
      "API Keys"
    ],
    "requestBody": false
  },
  {
    "name": "postApiMultisig",
    "method": "POST",
    "path": "/api/multisig",
    "summary": "Configure multisig (owner-only on-chain)",
    "tags": [
      "Multisig"
    ],
    "requestBody": true
  },
  {
    "name": "postApiMultisigApprove",
    "method": "POST",
    "path": "/api/multisig/approve",
    "summary": "Approve a pending multisig proposal",
    "tags": [
      "Multisig"
    ],
    "requestBody": true
  },
  {
    "name": "postApiMultisigExecute",
    "method": "POST",
    "path": "/api/multisig/execute",
    "summary": "Execute a fully approved multisig payment",
    "tags": [
      "Multisig"
    ],
    "requestBody": true
  },
  {
    "name": "postApiMultisigPropose",
    "method": "POST",
    "path": "/api/multisig/propose",
    "summary": "Propose a payment for multisig approval",
    "tags": [
      "Multisig"
    ],
    "requestBody": true
  },
  {
    "name": "postApiPayments",
    "method": "POST",
    "path": "/api/payments",
    "summary": "Create a payment",
    "tags": [
      "Payments"
    ],
    "requestBody": true
  },
  {
    "name": "postApiPaymentsCancel",
    "method": "POST",
    "path": "/api/payments/cancel",
    "summary": "Cancel a payment",
    "tags": [
      "Payments"
    ],
    "requestBody": true
  },
  {
    "name": "postApiPaymentsRetry",
    "method": "POST",
    "path": "/api/payments/retry",
    "summary": "Retry a failed payment",
    "tags": [
      "Payments"
    ],
    "requestBody": true
  },
  {
    "name": "postApiRecurring",
    "method": "POST",
    "path": "/api/recurring",
    "summary": "Create a recurring payment",
    "tags": [
      "Recurring"
    ],
    "requestBody": true
  },
  {
    "name": "postApiRefunds",
    "method": "POST",
    "path": "/api/refunds",
    "summary": "Persist a refund ledger row after an on-chain request_refund",
    "tags": [
      "Refunds"
    ],
    "requestBody": true
  },
  {
    "name": "postApiRequests",
    "method": "POST",
    "path": "/api/requests",
    "summary": "Create a payment request / payment link",
    "tags": [
      "Payment Requests"
    ],
    "requestBody": true
  },
  {
    "name": "postApiRequestsIdPaid",
    "method": "POST",
    "path": "/api/requests/{id}/paid",
    "summary": "Confirm payment for a payment request",
    "tags": [
      "Payment Requests"
    ],
    "requestBody": true
  },
  {
    "name": "postApiRequestsIdRemind",
    "method": "POST",
    "path": "/api/requests/{id}/remind",
    "summary": "Email a reminder for a payment request",
    "tags": [
      "Payment Requests"
    ],
    "requestBody": false
  },
  {
    "name": "postApiScheduled",
    "method": "POST",
    "path": "/api/scheduled",
    "summary": "Create a scheduled payment",
    "tags": [
      "Scheduled Payments"
    ],
    "requestBody": true
  },
  {
    "name": "postApiScheduledRun",
    "method": "POST",
    "path": "/api/scheduled/run",
    "summary": "Trigger the scheduled-payment sweep manually",
    "tags": [
      "Scheduled Payments"
    ],
    "requestBody": false
  },
  {
    "name": "postApiStreams",
    "method": "POST",
    "path": "/api/streams",
    "summary": "Create an on-chain payment stream",
    "tags": [
      "Streams"
    ],
    "requestBody": true
  },
  {
    "name": "postApiWebhooks",
    "method": "POST",
    "path": "/api/webhooks",
    "summary": "Register a new webhook",
    "tags": [
      "Webhooks"
    ],
    "requestBody": true
  },
  {
    "name": "postApiWebhooksIdDeliveriesDeliveryIdRedeliver",
    "method": "POST",
    "path": "/api/webhooks/{id}/deliveries/{deliveryId}/redeliver",
    "summary": "Redeliver a webhook payload from a prior delivery",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  },
  {
    "name": "postApiWebhooksIdReplay",
    "method": "POST",
    "path": "/api/webhooks/{id}/replay",
    "summary": "Replay stored webhook events within a bounded date range",
    "tags": [
      "Webhooks"
    ],
    "requestBody": true
  },
  {
    "name": "postApiWebhooksIdTest",
    "method": "POST",
    "path": "/api/webhooks/{id}/test",
    "summary": "Send a test webhook delivery",
    "tags": [
      "Webhooks"
    ],
    "requestBody": false
  }
];

/** @type {Record<string, ApiOperation>} */
export const OPERATION_BY_NAME = Object.fromEntries(
  API_OPERATIONS.map((op) => [op.name, op])
);
