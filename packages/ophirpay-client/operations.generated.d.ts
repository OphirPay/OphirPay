// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate

export interface ApiOperation {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  path: string;
  summary: string;
  tags: string[];
  requestBody: boolean;
}

export type ApiOperationName =
  | "deleteApiAuthSession"
  | "deleteApiKeys"
  | "deleteApiPaymentsId"
  | "deleteApiScheduled"
  | "deleteApiWebhooks"
  | "getApiAnalytics"
  | "getApiAssetsMetadata"
  | "getApiAuditLog"
  | "getApiAuditLogExport"
  | "getApiAuditLogSse"
  | "getApiAuthChallenge"
  | "getApiBatches"
  | "getApiBatchesId"
  | "getApiBatchesSummary"
  | "getApiContracts"
  | "getApiCron"
  | "getApiCsrf"
  | "getApiEscrows"
  | "getApiEscrowsId"
  | "getApiEvents"
  | "getApiEventsHistory"
  | "getApiFeeConfig"
  | "getApiFeeConfigCollector"
  | "getApiFeeConfigHistory"
  | "getApiGovernanceProposals"
  | "getApiGovernanceProposalsId"
  | "getApiHealth"
  | "getApiHealthLive"
  | "getApiHooks"
  | "getApiKeys"
  | "getApiKeysStats"
  | "getApiMetrics"
  | "getApiMultisig"
  | "getApiMultisigRequests"
  | "getApiPauseState"
  | "getApiPayments"
  | "getApiPaymentsExport"
  | "getApiPaymentsId"
  | "getApiPolicyVersions"
  | "getApiRbac"
  | "getApiRecurring"
  | "getApiRecurringId"
  | "getApiRefunds"
  | "getApiRequests"
  | "getApiRequestsExpire"
  | "getApiScheduled"
  | "getApiScheduledRun"
  | "getApiStats"
  | "getApiStreams"
  | "getApiStreamsId"
  | "getApiTimelock"
  | "getApiWebhooks"
  | "getApiWebhooksId"
  | "getApiWebhooksIdDeliveries"
  | "getApiWebhooksIdDeliveriesDeliveryId"
  | "getApiWebhooksIdTest"
  | "patchApiHooksId"
  | "patchApiKeys"
  | "patchApiPaymentsId"
  | "patchApiRecurring"
  | "patchApiRecurringId"
  | "patchApiRefundsId"
  | "patchApiWebhooks"
  | "postApiAuthSession"
  | "postApiBatches"
  | "postApiBatchesId"
  | "postApiCron"
  | "postApiCspReport"
  | "postApiEscrows"
  | "postApiGovernanceExecute"
  | "postApiGovernanceProposals"
  | "postApiGovernanceVote"
  | "postApiHooks"
  | "postApiJobsProcessDueRecurring"
  | "postApiKeys"
  | "postApiKeysIdRotate"
  | "postApiMultisig"
  | "postApiMultisigApprove"
  | "postApiMultisigExecute"
  | "postApiMultisigPropose"
  | "postApiPayments"
  | "postApiPaymentsCancel"
  | "postApiPaymentsRetry"
  | "postApiRecurring"
  | "postApiRefunds"
  | "postApiRequests"
  | "postApiRequestsIdPaid"
  | "postApiRequestsIdRemind"
  | "postApiScheduled"
  | "postApiScheduledRun"
  | "postApiStreams"
  | "postApiWebhooks"
  | "postApiWebhooksIdDeliveriesDeliveryIdRedeliver"
  | "postApiWebhooksIdReplay"
  | "postApiWebhooksIdTest";

export interface OpenApiSchemas {
  AssetMetadata: {
    code?: string;
    issuer?: string;
    name?: string | null;
    description?: string | null;
    image?: string | null;
    decimals?: number | null;
    orgName?: string | null;
    homeDomain?: string | null;
    source?: "toml" | "cache" | "fallback";
    fetchedAt?: string;
  };
  BatchResponse: {
    id?: string;
    userId?: string;
    name?: string;
    description?: string | null;
    status?: "CREATED" | "PROCESSING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED";
    createdAt?: string;
    updatedAt?: string;
    payments?: OpenApiSchemas["PaymentResponse"][];
  };
  BulkCancelBatchResponse: {
    success?: true;
    data?: {
      batchId?: string;
      cancelled?: number;
      skipped?: number;
      total?: number;
    };
    meta?: {
      timestamp?: string;
    };
  };
  CreateBatchRequest: {
    name: string;
    description?: string;
    idempotencyKey?: string;
    recipients: {
      address: string;
      amount: number;
      assetCode?: string;
      memo?: string;
    }[];
    sourceAccountId: string;
  };
  CreatePaymentRequest: {
    amount: number;
    assetCode?: string;
    assetIssuer?: string;
    description?: string;
    memo?: string;
    sourceAccountId: string;
    destAddress: string;
  };
  CreatePaymentRequestSchema: {
    amount: number;
    assetCode?: string;
    assetIssuer?: string;
    description?: string;
    recipientAddress?: string;
  };
  CreateRecurrenceRequest: {
    name: string;
    frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
    amount: number;
    assetCode?: string;
    destAddress: string;
    description?: string;
    sourceAccountId: string;
  };
  CreateWebhookRequest: {
    url: string;
    events: ("payment.created" | "payment.signed" | "payment.submitted" | "payment.confirmed" | "payment.completed" | "payment.failed" | "batch.created" | "batch.completed" | "batch.failed" | "recurrence.triggered" | "recurrence.completed" | "recurrence.failed" | "request.created" | "request.paid" | "request.expired")[];
    isActive?: boolean;
  };
  ErrorResponse: {
    success?: false;
    error?: {
      code?: string;
      message?: string;
    };
  };
  HealthResponse: {
    success?: boolean;
    data?: {
      version?: string;
      status?: "ok" | "degraded" | "down";
      services?: {
        database?: {
          status?: "ok" | "error";
          latencyMs?: number | null;
        };
        redis?: {
          status?: "ok" | "error" | "disabled";
          latencyMs?: number | null;
        };
        stellar?: {
          network?: string;
          rpcUrl?: string;
          horizonUrl?: string;
          rpc?: {
            status?: "ok" | "error" | "unchecked";
            latencyMs?: number | null;
          };
          horizon?: {
            status?: "ok" | "error" | "unchecked";
            latencyMs?: number | null;
          };
          contracts?: {
            status?: "ok" | "error";
            ophirpay?: {
              id?: string | null;
              status?: "ok" | "error" | "not_configured";
            };
            emitter?: {
              id?: string | null;
              status?: "ok" | "error" | "not_configured";
            };
            chainReadSource?: {
              id?: string | null;
              status?: "ok" | "error" | "not_configured";
            };
          };
        };
      };
      uptime?: number;
    };
    meta?: {
      timestamp?: string;
    };
  };
  PaginatedBatches: {
    success?: true;
    data?: OpenApiSchemas["BatchResponse"][];
    meta?: {
      page?: number;
      limit?: number;
      total?: number;
      nextCursor?: string | null;
      hasMore?: boolean;
    };
  };
  PaginatedPayments: {
    success?: true;
    data?: OpenApiSchemas["PaymentResponse"][];
    meta?: {
      page?: number;
      limit?: number;
      total?: number;
      nextCursor?: string | null;
      hasMore?: boolean;
    };
  };
  PaymentEnvelopeResponse: {
    success?: true;
    data?: OpenApiSchemas["PaymentResponse"];
    meta?: {
      timestamp?: string;
    };
  };
  PaymentResponse: {
    id?: string;
    amount?: number;
    assetCode?: string;
    assetIssuer?: string | null;
    description?: string | null;
    memo?: string | null;
    status?: string;
    transactionHash?: string | null;
    idempotencyKey?: string | null;
    sourceAccountId?: string;
    userId?: string;
    batchId?: string | null;
    createdAt?: string;
    completedAt?: string | null;
    errorMessage?: string | null;
  };
  TestWebhookResponse: {
    delivered?: boolean;
    status?: "delivered" | "failed";
    event?: string;
    test?: boolean;
    durationMs?: number;
    sentAt?: string;
  };
}

export type AssetMetadata = OpenApiSchemas["AssetMetadata"];
export type BatchResponse = OpenApiSchemas["BatchResponse"];
export type BulkCancelBatchResponse = OpenApiSchemas["BulkCancelBatchResponse"];
export type CreateBatchRequest = OpenApiSchemas["CreateBatchRequest"];
export type CreatePaymentRequest = OpenApiSchemas["CreatePaymentRequest"];
export type CreatePaymentRequestSchema = OpenApiSchemas["CreatePaymentRequestSchema"];
export type CreateRecurrenceRequest = OpenApiSchemas["CreateRecurrenceRequest"];
export type CreateWebhookRequest = OpenApiSchemas["CreateWebhookRequest"];
export type ErrorResponse = OpenApiSchemas["ErrorResponse"];
export type HealthResponse = OpenApiSchemas["HealthResponse"];
export type PaginatedBatches = OpenApiSchemas["PaginatedBatches"];
export type PaginatedPayments = OpenApiSchemas["PaginatedPayments"];
export type PaymentEnvelopeResponse = OpenApiSchemas["PaymentEnvelopeResponse"];
export type PaymentResponse = OpenApiSchemas["PaymentResponse"];
export type TestWebhookResponse = OpenApiSchemas["TestWebhookResponse"];

export interface ApiOperationMap {
  deleteApiAuthSession: {
    method: "DELETE";
    path: "/api/auth/session";
    requestBody: never;
    response: unknown;
  };
  deleteApiKeys: {
    method: "DELETE";
    path: "/api/keys";
    requestBody: never;
    response: unknown;
  };
  deleteApiPaymentsId: {
    method: "DELETE";
    path: "/api/payments/{id}";
    requestBody: never;
    response: unknown;
  };
  deleteApiScheduled: {
    method: "DELETE";
    path: "/api/scheduled";
    requestBody: never;
    response: unknown;
  };
  deleteApiWebhooks: {
    method: "DELETE";
    path: "/api/webhooks";
    requestBody: never;
    response: unknown;
  };
  getApiAnalytics: {
    method: "GET";
    path: "/api/analytics";
    requestBody: never;
    response: {
      success?: boolean;
      data?: {
        totalPayments?: number;
        completedPayments?: number;
        failedPayments?: number;
        totalVolume?: number;
        averageAmount?: number;
        successRate?: number;
        volumeByDay?: {
          date?: string;
          volume?: number;
          count?: number;
        }[];
      };
    };
  };
  getApiAssetsMetadata: {
    method: "GET";
    path: "/api/assets/metadata";
    requestBody: never;
    response: {
      success?: true;
      data?: OpenApiSchemas["AssetMetadata"];
    };
  };
  getApiAuditLog: {
    method: "GET";
    path: "/api/audit-log";
    requestBody: never;
    response: unknown;
  };
  getApiAuditLogExport: {
    method: "GET";
    path: "/api/audit-log/export";
    requestBody: never;
    response: unknown;
  };
  getApiAuditLogSse: {
    method: "GET";
    path: "/api/audit-log/sse";
    requestBody: never;
    response: unknown;
  };
  getApiAuthChallenge: {
    method: "GET";
    path: "/api/auth/challenge";
    requestBody: never;
    response: {
      challenge: string;
      message: string;
      expiresIn: number;
    };
  };
  getApiBatches: {
    method: "GET";
    path: "/api/batches";
    requestBody: never;
    response: OpenApiSchemas["PaginatedBatches"];
  };
  getApiBatchesId: {
    method: "GET";
    path: "/api/batches/{id}";
    requestBody: never;
    response: unknown;
  };
  getApiBatchesSummary: {
    method: "GET";
    path: "/api/batches/summary";
    requestBody: never;
    response: unknown;
  };
  getApiContracts: {
    method: "GET";
    path: "/api/contracts";
    requestBody: never;
    response: unknown;
  };
  getApiCron: {
    method: "GET";
    path: "/api/cron";
    requestBody: never;
    response: unknown;
  };
  getApiCsrf: {
    method: "GET";
    path: "/api/csrf";
    requestBody: never;
    response: unknown;
  };
  getApiEscrows: {
    method: "GET";
    path: "/api/escrows";
    requestBody: never;
    response: unknown;
  };
  getApiEscrowsId: {
    method: "GET";
    path: "/api/escrows/{id}";
    requestBody: never;
    response: unknown;
  };
  getApiEvents: {
    method: "GET";
    path: "/api/events";
    requestBody: never;
    response: unknown;
  };
  getApiEventsHistory: {
    method: "GET";
    path: "/api/events/history";
    requestBody: never;
    response: unknown;
  };
  getApiFeeConfig: {
    method: "GET";
    path: "/api/fee-config";
    requestBody: never;
    response: unknown;
  };
  getApiFeeConfigCollector: {
    method: "GET";
    path: "/api/fee-config/collector";
    requestBody: never;
    response: unknown;
  };
  getApiFeeConfigHistory: {
    method: "GET";
    path: "/api/fee-config/history";
    requestBody: never;
    response: unknown;
  };
  getApiGovernanceProposals: {
    method: "GET";
    path: "/api/governance/proposals";
    requestBody: never;
    response: {
      success?: true;
      data?: {
        items?: ({
          id?: number;
          title?: string;
          description?: string;
          action_type?: string;
          yes_votes?: number;
          no_votes?: number;
          voting_ends_at?: number | null;
          executed?: boolean;
          proposer?: string;
        })[];
        total?: number;
        truncated?: boolean;
      };
    };
  };
  getApiGovernanceProposalsId: {
    method: "GET";
    path: "/api/governance/proposals/{id}";
    requestBody: never;
    response: {
      success?: true;
      data?: {
        proposal?: unknown;
        config?: unknown;
        voteHistory?: ({
          voter?: string | null;
          support?: boolean | null;
          transactionHash?: string | null;
          recordedAt?: string;
        })[];
      };
    };
  };
  getApiHealth: {
    method: "GET";
    path: "/api/health";
    requestBody: never;
    response: OpenApiSchemas["HealthResponse"];
  };
  getApiHealthLive: {
    method: "GET";
    path: "/api/health/live";
    requestBody: never;
    response: {
      success: true;
      data: {
        status: "ok";
        probe: "liveness";
        version: string;
        uptime?: number;
      };
      meta?: {
        timestamp?: string;
      };
    };
  };
  getApiHooks: {
    method: "GET";
    path: "/api/hooks";
    requestBody: never;
    response: unknown;
  };
  getApiKeys: {
    method: "GET";
    path: "/api/keys";
    requestBody: never;
    response: unknown;
  };
  getApiKeysStats: {
    method: "GET";
    path: "/api/keys/stats";
    requestBody: never;
    response: unknown;
  };
  getApiMetrics: {
    method: "GET";
    path: "/api/metrics";
    requestBody: never;
    response: unknown;
  };
  getApiMultisig: {
    method: "GET";
    path: "/api/multisig";
    requestBody: never;
    response: {
      success?: boolean;
      data?: {
        threshold?: number;
        signers?: string[];
        enabled?: boolean;
      };
    };
  };
  getApiMultisigRequests: {
    method: "GET";
    path: "/api/multisig/requests";
    requestBody: never;
    response: unknown;
  };
  getApiPauseState: {
    method: "GET";
    path: "/api/pause-state";
    requestBody: never;
    response: unknown;
  };
  getApiPayments: {
    method: "GET";
    path: "/api/payments";
    requestBody: never;
    response: OpenApiSchemas["PaginatedPayments"];
  };
  getApiPaymentsExport: {
    method: "GET";
    path: "/api/payments/export";
    requestBody: never;
    response: unknown;
  };
  getApiPaymentsId: {
    method: "GET";
    path: "/api/payments/{id}";
    requestBody: never;
    response: OpenApiSchemas["PaymentEnvelopeResponse"];
  };
  getApiPolicyVersions: {
    method: "GET";
    path: "/api/policy-versions";
    requestBody: never;
    response: unknown;
  };
  getApiRbac: {
    method: "GET";
    path: "/api/rbac";
    requestBody: never;
    response: unknown;
  };
  getApiRecurring: {
    method: "GET";
    path: "/api/recurring";
    requestBody: never;
    response: unknown;
  };
  getApiRecurringId: {
    method: "GET";
    path: "/api/recurring/{id}";
    requestBody: never;
    response: unknown;
  };
  getApiRefunds: {
    method: "GET";
    path: "/api/refunds";
    requestBody: never;
    response: unknown;
  };
  getApiRequests: {
    method: "GET";
    path: "/api/requests";
    requestBody: never;
    response: unknown;
  };
  getApiRequestsExpire: {
    method: "GET";
    path: "/api/requests/expire";
    requestBody: never;
    response: unknown;
  };
  getApiScheduled: {
    method: "GET";
    path: "/api/scheduled";
    requestBody: never;
    response: unknown;
  };
  getApiScheduledRun: {
    method: "GET";
    path: "/api/scheduled/run";
    requestBody: never;
    response: unknown;
  };
  getApiStats: {
    method: "GET";
    path: "/api/stats";
    requestBody: never;
    response: unknown;
  };
  getApiStreams: {
    method: "GET";
    path: "/api/streams";
    requestBody: never;
    response: unknown;
  };
  getApiStreamsId: {
    method: "GET";
    path: "/api/streams/{id}";
    requestBody: never;
    response: unknown;
  };
  getApiTimelock: {
    method: "GET";
    path: "/api/timelock";
    requestBody: never;
    response: unknown;
  };
  getApiWebhooks: {
    method: "GET";
    path: "/api/webhooks";
    requestBody: never;
    response: unknown;
  };
  getApiWebhooksId: {
    method: "GET";
    path: "/api/webhooks/{id}";
    requestBody: never;
    response: unknown;
  };
  getApiWebhooksIdDeliveries: {
    method: "GET";
    path: "/api/webhooks/{id}/deliveries";
    requestBody: never;
    response: unknown;
  };
  getApiWebhooksIdDeliveriesDeliveryId: {
    method: "GET";
    path: "/api/webhooks/{id}/deliveries/{deliveryId}";
    requestBody: never;
    response: unknown;
  };
  getApiWebhooksIdTest: {
    method: "GET";
    path: "/api/webhooks/{id}/test";
    requestBody: never;
    response: unknown;
  };
  patchApiHooksId: {
    method: "PATCH";
    path: "/api/hooks/{id}";
    requestBody: {
      active: boolean;
    };
    response: unknown;
  };
  patchApiKeys: {
    method: "PATCH";
    path: "/api/keys";
    requestBody: {
      id: string;
      scopes: ("read:payments" | "write:payments" | "read:analytics" | "admin")[];
    };
    response: unknown;
  };
  patchApiPaymentsId: {
    method: "PATCH";
    path: "/api/payments/{id}";
    requestBody: {
      status?: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
      description?: string;
      memo?: string;
    };
    response: unknown;
  };
  patchApiRecurring: {
    method: "PATCH";
    path: "/api/recurring";
    requestBody: {
      id: string;
      paused: boolean;
    };
    response: unknown;
  };
  patchApiRecurringId: {
    method: "PATCH";
    path: "/api/recurring/{id}";
    requestBody: never;
    response: unknown;
  };
  patchApiRefundsId: {
    method: "PATCH";
    path: "/api/refunds/{id}";
    requestBody: {
      status: "APPROVED" | "PROCESSED" | "REJECTED";
    };
    response: unknown;
  };
  patchApiWebhooks: {
    method: "PATCH";
    path: "/api/webhooks";
    requestBody: never;
    response: unknown;
  };
  postApiAuthSession: {
    method: "POST";
    path: "/api/auth/session";
    requestBody: {
      publicKey: string;
      signature: string;
    };
    response: unknown;
  };
  postApiBatches: {
    method: "POST";
    path: "/api/batches";
    requestBody: OpenApiSchemas["CreateBatchRequest"];
    response: {
      success?: true;
      data?: OpenApiSchemas["BatchResponse"];
      meta?: {
        timestamp?: string;
      };
    };
  };
  postApiBatchesId: {
    method: "POST";
    path: "/api/batches/{id}";
    requestBody: never;
    response: OpenApiSchemas["BulkCancelBatchResponse"];
  };
  postApiCron: {
    method: "POST";
    path: "/api/cron";
    requestBody: never;
    response: unknown;
  };
  postApiCspReport: {
    method: "POST";
    path: "/api/csp-report";
    requestBody: never;
    response: unknown;
  };
  postApiEscrows: {
    method: "POST";
    path: "/api/escrows";
    requestBody: {
      payee: string;
      amount: number;
      assetCode?: string;
      releaseAfter?: number;
      releaseTo?: string;
      memo?: string;
    };
    response: unknown;
  };
  postApiGovernanceExecute: {
    method: "POST";
    path: "/api/governance/execute";
    requestBody: {
      proposalId: number;
    };
    response: unknown;
  };
  postApiGovernanceProposals: {
    method: "POST";
    path: "/api/governance/proposals";
    requestBody: {
      proposer: string;
      title: string;
      description?: string;
      actionType?: string;
      target?: string;
      data?: string;
      depositAsset?: string;
      depositAmount?: number;
    };
    response: unknown;
  };
  postApiGovernanceVote: {
    method: "POST";
    path: "/api/governance/vote";
    requestBody: {
      proposalId: number;
      voter: string;
      support?: boolean;
    };
    response: unknown;
  };
  postApiHooks: {
    method: "POST";
    path: "/api/hooks";
    requestBody: {
      eventType: string;
      webhookUrl: string;
      onChainId?: number;
    };
    response: unknown;
  };
  postApiJobsProcessDueRecurring: {
    method: "POST";
    path: "/api/jobs/process-due-recurring";
    requestBody: {
      limit?: number;
    };
    response: unknown;
  };
  postApiKeys: {
    method: "POST";
    path: "/api/keys";
    requestBody: {
      name: string;
      scopes?: ("read:payments" | "write:payments" | "read:analytics" | "admin")[];
    };
    response: {
      success?: true;
      data?: {
        id?: string;
        name?: string;
        prefix?: string;
        scopes?: string[];
        key?: string;
      };
    };
  };
  postApiKeysIdRotate: {
    method: "POST";
    path: "/api/keys/{id}/rotate";
    requestBody: never;
    response: {
      success?: true;
      data?: {
        id?: string;
        name?: string;
        prefix?: string;
        scopes?: string[];
        key?: string;
        previousPrefix?: string;
        previousKeyValidUntil?: string;
      };
    };
  };
  postApiMultisig: {
    method: "POST";
    path: "/api/multisig";
    requestBody: {
      threshold?: number;
      signers?: string[];
      enabled?: boolean;
    };
    response: unknown;
  };
  postApiMultisigApprove: {
    method: "POST";
    path: "/api/multisig/approve";
    requestBody: {
      requestId: number;
    };
    response: unknown;
  };
  postApiMultisigExecute: {
    method: "POST";
    path: "/api/multisig/execute";
    requestBody: {
      requestId: number;
    };
    response: unknown;
  };
  postApiMultisigPropose: {
    method: "POST";
    path: "/api/multisig/propose";
    requestBody: {
      payee: string;
      amount: number;
      assetCode?: string;
      memo?: string;
    };
    response: unknown;
  };
  postApiPayments: {
    method: "POST";
    path: "/api/payments";
    requestBody: OpenApiSchemas["CreatePaymentRequest"];
    response: OpenApiSchemas["PaymentEnvelopeResponse"];
  };
  postApiPaymentsCancel: {
    method: "POST";
    path: "/api/payments/cancel";
    requestBody: {
      txHash: string;
    };
    response: unknown;
  };
  postApiPaymentsRetry: {
    method: "POST";
    path: "/api/payments/retry";
    requestBody: {
      id: string;
    };
    response: OpenApiSchemas["PaymentEnvelopeResponse"];
  };
  postApiRecurring: {
    method: "POST";
    path: "/api/recurring";
    requestBody: OpenApiSchemas["CreateRecurrenceRequest"];
    response: unknown;
  };
  postApiRefunds: {
    method: "POST";
    path: "/api/refunds";
    requestBody: {
      paymentId: number;
      amount: number;
      asset?: string;
      reason?: string;
      reasonCode?: number;
      onChainId?: number;
    };
    response: unknown;
  };
  postApiRequests: {
    method: "POST";
    path: "/api/requests";
    requestBody: OpenApiSchemas["CreatePaymentRequestSchema"];
    response: unknown;
  };
  postApiRequestsIdPaid: {
    method: "POST";
    path: "/api/requests/{id}/paid";
    requestBody: {
      transactionHash: string;
    };
    response: unknown;
  };
  postApiRequestsIdRemind: {
    method: "POST";
    path: "/api/requests/{id}/remind";
    requestBody: never;
    response: unknown;
  };
  postApiScheduled: {
    method: "POST";
    path: "/api/scheduled";
    requestBody: {
      amount: number;
      assetCode: string;
      assetIssuer?: string;
      destAddress: string;
      memo?: string;
      scheduledAt: string;
    };
    response: unknown;
  };
  postApiScheduledRun: {
    method: "POST";
    path: "/api/scheduled/run";
    requestBody: never;
    response: unknown;
  };
  postApiStreams: {
    method: "POST";
    path: "/api/streams";
    requestBody: {
      payee: string;
      amount: number;
      assetCode?: string;
      startTime?: number;
      endTime?: number;
      memo?: string;
    };
    response: unknown;
  };
  postApiWebhooks: {
    method: "POST";
    path: "/api/webhooks";
    requestBody: OpenApiSchemas["CreateWebhookRequest"];
    response: unknown;
  };
  postApiWebhooksIdDeliveriesDeliveryIdRedeliver: {
    method: "POST";
    path: "/api/webhooks/{id}/deliveries/{deliveryId}/redeliver";
    requestBody: never;
    response: unknown;
  };
  postApiWebhooksIdReplay: {
    method: "POST";
    path: "/api/webhooks/{id}/replay";
    requestBody: {
      since?: string;
      until?: string;
      limit?: number;
    };
    response: unknown;
  };
  postApiWebhooksIdTest: {
    method: "POST";
    path: "/api/webhooks/{id}/test";
    requestBody: never;
    response: unknown;
  };
}

export declare const API_OPERATIONS: ReadonlyArray<ApiOperation>;
export declare const OPERATION_BY_NAME: Record<ApiOperationName, ApiOperation>;
export declare const COMPONENT_SCHEMA_NAMES: ReadonlyArray<keyof OpenApiSchemas>;
