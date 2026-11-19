// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run generate:sdk
//
// 100 operations and 17 component schemas from
// the committed OpenAPI document. Regenerate after editing the spec.

// ── Component schemas ─────────────────────────────────────────
export interface AssetMetadata {
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
}

export interface BatchResponse {
  id?: string;
  userId?: string;
  name?: string;
  description?: string | null;
  status?: "CREATED" | "PROCESSING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED";
  createdAt?: string;
  updatedAt?: string;
  payments?: Array<PaymentResponse>;
}

export interface BulkCancelBatchResponse {
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
}

export interface CreateBatchRequest {
  name: string;
  description?: string;
  idempotencyKey?: string;
  recipients: Array<{
    address: string;
    amount: number;
    assetCode?: string;
    memo?: string;
  }>;
  sourceAccountId: string;
}

export interface CreatePaymentRequest {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  memo?: string;
  memoType?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
  sourceAccountId: string;
  destAddress: string;
}

export interface CreatePaymentRequestSchema {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  recipientAddress?: string;
}

export interface CreateRecurrenceRequest {
  name: string;
  frequency: "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  amount: number;
  assetCode?: string;
  destAddress: string;
  description?: string;
  sourceAccountId: string;
}

export interface CreateWebhookRequest {
  url: string;
  events: Array<"payment.created" | "payment.signed" | "payment.submitted" | "payment.confirmed" | "payment.completed" | "payment.failed" | "batch.created" | "batch.completed" | "batch.failed" | "recurrence.triggered" | "recurrence.completed" | "recurrence.failed" | "request.created" | "request.paid" | "request.expired">;
  isActive?: boolean;
}

export interface ErrorResponse {
  success?: false;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface HealthResponse {
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
}

export interface PaginatedBatches {
  success?: true;
  data?: Array<BatchResponse>;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
}

export interface PaginatedPayments {
  success?: true;
  data?: Array<PaymentResponse>;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
}

export interface PaymentEnvelopeResponse {
  success?: true;
  data?: PaymentResponse;
  meta?: {
    timestamp?: string;
  };
}

export interface PaymentResponse {
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
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: Array<ProblemFieldError>;
}

export interface ProblemFieldError {
  field: string;
  message: string;
  code?: string;
}

export interface TestWebhookResponse {
  delivered?: boolean;
  status?: "delivered" | "failed";
  event?: string;
  test?: boolean;
  durationMs?: number;
  sentAt?: string;
}

// ── Typed operation maps ──────────────────────────────────────
/** Request body type per operation (issue #1439). */
export interface ApiRequestBodies {
  deleteApiAuthSession: undefined;
  deleteApiKeys: undefined;
  deleteApiPaymentsId: undefined;
  deleteApiScheduled: undefined;
  deleteApiWebhooks: undefined;
  getApiAnalytics: undefined;
  getApiAssetsMetadata: undefined;
  getApiAuditLog: undefined;
  getApiAuditLogExport: undefined;
  getApiAuditLogSse: undefined;
  getApiAuthChallenge: undefined;
  getApiBatches: undefined;
  getApiBatchesId: undefined;
  getApiBatchesSummary: undefined;
  getApiContracts: undefined;
  getApiCron: undefined;
  getApiCsrf: undefined;
  getApiEscrows: undefined;
  getApiEscrowsId: undefined;
  getApiEvents: undefined;
  getApiEventsHistory: undefined;
  getApiFeeConfig: undefined;
  getApiFeeConfigCollector: undefined;
  getApiFeeConfigHistory: undefined;
  getApiGovernanceProposals: undefined;
  getApiGovernanceProposalsId: undefined;
  getApiHealth: undefined;
  getApiHealthLive: undefined;
  getApiHealthReady: undefined;
  getApiHooks: undefined;
  getApiKeys: undefined;
  getApiKeysStats: undefined;
  getApiMetrics: undefined;
  getApiMultisig: undefined;
  getApiMultisigRequests: undefined;
  getApiOpenapiJson: undefined;
  getApiPauseState: undefined;
  getApiPayments: undefined;
  getApiPaymentsExport: undefined;
  getApiPaymentsId: undefined;
  getApiPolicyVersions: undefined;
  getApiRbac: undefined;
  getApiRecurring: undefined;
  getApiRecurringId: undefined;
  getApiRefunds: undefined;
  getApiRequests: undefined;
  getApiRequestsExpire: undefined;
  getApiScheduled: undefined;
  getApiScheduledRun: undefined;
  getApiStats: undefined;
  getApiStreams: undefined;
  getApiStreamsId: undefined;
  getApiTimelock: undefined;
  getApiWebhooks: undefined;
  getApiWebhooksId: undefined;
  getApiWebhooksIdDeliveries: undefined;
  getApiWebhooksIdDeliveriesDeliveryId: undefined;
  getApiWebhooksIdTest: undefined;
  patchApiHooksId: {
      active: boolean;
    };
  patchApiKeys: {
      id: string;
      scopes: Array<"read:payments" | "write:payments" | "payments:write" | "batches:create" | "escrow:write" | "escrow:release" | "webhooks:write" | "read:analytics" | "admin">;
    };
  patchApiPaymentsId: {
      status?: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
      description?: string;
      memo?: string;
    };
  patchApiRecurring: {
      id: string;
      paused: boolean;
    };
  patchApiRecurringId: undefined;
  patchApiRefundsId: {
      status: "APPROVED" | "PROCESSED" | "REJECTED";
    };
  patchApiWebhooks: undefined;
  postApiAuthSession: {
      publicKey: string;
      signature: string;
    };
  postApiBatches: CreateBatchRequest;
  postApiBatchesId: undefined;
  postApiCron: undefined;
  postApiCspReport: undefined;
  postApiEscrows: {
      payee: string;
      amount: number;
      assetCode?: string;
      releaseAfter?: number;
      releaseTo?: string;
      memo?: string;
    };
  postApiFeeConfig: {
      action: "set_fee_config" | "set_fee_collector";
      paymentFeeBps?: number;
      escrowFeeBps?: number;
      streamFeeBps?: number;
      batchBaseFee?: number;
      batchPerItemFee?: number;
      enabled?: boolean;
      collector?: string;
      challenge?: string;
      signature?: string;
    };
  postApiGovernanceExecute: {
      proposalId: number;
    };
  postApiGovernanceProposals: {
      proposer: string;
      title: string;
      description?: string;
      actionType?: string;
      target?: string;
      data?: string;
      depositAsset?: string;
      depositAmount?: number;
    };
  postApiGovernanceVote: {
      proposalId: number;
      voter: string;
      support?: boolean;
    };
  postApiHooks: {
      eventType: string;
      webhookUrl: string;
      onChainId?: number;
    };
  postApiJobsProcessDueRecurring: {
      limit?: number;
    };
  postApiKeys: {
      name: string;
      scopes?: Array<"read:payments" | "write:payments" | "payments:write" | "batches:create" | "escrow:write" | "escrow:release" | "webhooks:write" | "read:analytics" | "admin">;
    };
  postApiKeysIdRotate: undefined;
  postApiMultisig: {
      threshold?: number;
      signers?: Array<string>;
      enabled?: boolean;
    };
  postApiMultisigApprove: {
      requestId: number;
    };
  postApiMultisigExecute: {
      requestId: number;
    };
  postApiMultisigPropose: {
      payee: string;
      amount: number;
      assetCode?: string;
      memo?: string;
    };
  postApiPayments: CreatePaymentRequest;
  postApiPaymentsCancel: {
      txHash: string;
    };
  postApiPaymentsRetry: {
      id: string;
    };
  postApiRbac: {
      action: "grant" | "revoke";
      address: string;
      role?: number;
      challenge?: string;
      signature?: string;
    };
  postApiRecurring: CreateRecurrenceRequest;
  postApiRefunds: {
      paymentId: number;
      amount: number;
      asset?: string;
      reason?: string;
      reasonCode?: number;
      onChainId?: number;
    };
  postApiRequests: CreatePaymentRequestSchema;
  postApiRequestsIdPaid: {
      transactionHash: string;
    };
  postApiRequestsIdRemind: undefined;
  postApiScheduled: {
      amount: number;
      assetCode: string;
      assetIssuer?: string;
      destAddress: string;
      memo?: string;
      scheduledAt: string;
    };
  postApiScheduledRun: undefined;
  postApiStreams: {
      payee: string;
      amount: number;
      assetCode?: string;
      startTime?: number;
      endTime?: number;
      memo?: string;
    };
  postApiWebhooks: CreateWebhookRequest;
  postApiWebhooksIdDeliveriesDeliveryIdRedeliver: undefined;
  postApiWebhooksIdDeliveriesRequeue: {
      statusCodes?: Array<number>;
      onlyTimeouts?: boolean;
      limit?: number;
      deliveryIds?: Array<string>;
    };
  postApiWebhooksIdReplay: {
      since?: string;
      until?: string;
      limit?: number;
    };
  postApiWebhooksIdTest: undefined;
}

// ── Typed operation maps ──────────────────────────────────────
/** Response body type per operation, keyed by HTTP status code. */
export interface ApiResponseBodies {
  deleteApiAuthSession: {
    "200": unknown;
  };
  deleteApiKeys: {
    "200": unknown;
    "400": unknown;
  };
  deleteApiPaymentsId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  deleteApiScheduled: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  deleteApiWebhooks: {
    "200": unknown;
    "400": unknown;
    "401": ErrorResponse;
  };
  getApiAnalytics: {
    "200": {
      success?: boolean;
      data?: {
        totalPayments?: number;
        completedPayments?: number;
        failedPayments?: number;
        totalVolume?: number;
        averageAmount?: number;
        successRate?: number;
        volumeByDay?: Array<{
          date?: string;
          volume?: number;
          count?: number;
        }>;
      };
    };
  };
  getApiAssetsMetadata: {
    "200": {
      success?: true;
      data?: AssetMetadata;
    };
    "400": ErrorResponse;
  };
  getApiAuditLog: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiAuditLogExport: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiAuditLogSse: {
    "200": string;
  };
  getApiAuthChallenge: {
    "200": {
      challenge: string;
      message: string;
      expiresIn: number;
    };
    "400": unknown;
  };
  getApiBatches: {
    "200": PaginatedBatches;
    "401": ErrorResponse;
  };
  getApiBatchesId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  getApiBatchesSummary: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiContracts: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiCron: {
    "200": unknown;
    "401": ErrorResponse;
    "503": unknown;
  };
  getApiCsrf: {
    "200": unknown;
  };
  getApiEscrows: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiEscrowsId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  getApiEvents: {
    "200": string;
  };
  getApiEventsHistory: {
    "200": unknown;
    "400": ErrorResponse;
  };
  getApiFeeConfig: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiFeeConfigCollector: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiFeeConfigHistory: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiGovernanceProposals: {
    "200": {
      success?: true;
      data?: {
        items?: Array<{
          id?: number;
          title?: string;
          description?: string;
          action_type?: string;
          yes_votes?: number;
          no_votes?: number;
          voting_ends_at?: number | null;
          executed?: boolean;
          proposer?: string;
        }>;
        total?: number;
        truncated?: boolean;
      };
    };
  };
  getApiGovernanceProposalsId: {
    "200": {
      success?: true;
      data?: {
        proposal?: Record<string, unknown>;
        config?: Record<string, unknown>;
        voteHistory?: Array<{
          voter?: string | null;
          support?: boolean | null;
          transactionHash?: string | null;
          recordedAt?: string;
        }>;
      };
    };
    "400": unknown;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  getApiHealth: {
    "200": HealthResponse;
    "503": HealthResponse;
  };
  getApiHealthLive: {
    "200": {
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
  getApiHealthReady: {
    "200": unknown;
    "503": unknown;
  };
  getApiHooks: {
    "200": unknown;
  };
  getApiKeys: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiKeysStats: {
    "200": unknown;
    "400": unknown;
    "401": ErrorResponse;
  };
  getApiMetrics: {
    "200": string;
    "401": ErrorResponse;
  };
  getApiMultisig: {
    "200": {
      success?: boolean;
      data?: {
        threshold?: number;
        signers?: Array<string>;
        enabled?: boolean;
      };
    };
  };
  getApiMultisigRequests: {
    "200": unknown;
  };
  getApiOpenapiJson: {
    "200": Record<string, unknown>;
  };
  getApiPauseState: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiPayments: {
    "200": PaginatedPayments;
    "400": ProblemDetails;
    "401": ProblemDetails;
  };
  getApiPaymentsExport: {
    "200": Array<Record<string, string>>;
    "400": ProblemDetails;
    "401": ProblemDetails;
    "429": ProblemDetails;
  };
  getApiPaymentsId: {
    "200": PaymentEnvelopeResponse;
    "404": ErrorResponse;
  };
  getApiPolicyVersions: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiRbac: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiRecurring: {
    "200": unknown;
  };
  getApiRecurringId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  getApiRefunds: {
    "200": unknown;
  };
  getApiRequests: {
    "200": unknown;
  };
  getApiRequestsExpire: {
    "200": unknown;
    "401": ErrorResponse;
    "503": unknown;
  };
  getApiScheduled: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiScheduledRun: {
    "200": unknown;
    "401": ErrorResponse;
    "503": unknown;
  };
  getApiStats: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiStreams: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiStreamsId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  getApiTimelock: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  getApiWebhooks: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiWebhooksId: {
    "200": unknown;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  getApiWebhooksIdDeliveries: {
    "200": unknown;
    "401": ErrorResponse;
  };
  getApiWebhooksIdDeliveriesDeliveryId: {
    "200": unknown;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  getApiWebhooksIdTest: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  patchApiHooksId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  patchApiKeys: {
    "200": unknown;
    "400": unknown;
  };
  patchApiPaymentsId: {
    "200": unknown;
    "404": ErrorResponse;
  };
  patchApiRecurring: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "404": unknown;
  };
  patchApiRecurringId: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  patchApiRefundsId: {
    "200": unknown;
    "400": ErrorResponse;
    "404": ErrorResponse;
  };
  patchApiWebhooks: {
    "200": unknown;
    "400": unknown;
    "401": ErrorResponse;
  };
  postApiAuthSession: {
    "200": unknown;
    "401": ErrorResponse;
  };
  postApiBatches: {
    "200": unknown;
    "201": {
      success?: true;
      data?: BatchResponse;
      meta?: {
        timestamp?: string;
      };
    };
    "400": ErrorResponse;
    "401": ErrorResponse;
    "409": ErrorResponse;
  };
  postApiBatchesId: {
    "200": BulkCancelBatchResponse;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  postApiCron: {
    "200": unknown;
    "401": ErrorResponse;
    "503": unknown;
  };
  postApiCspReport: {
    "204": unknown;
    "400": unknown;
    "413": unknown;
  };
  postApiEscrows: {
    "201": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "409": ErrorResponse;
  };
  postApiFeeConfig: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "403": ErrorResponse;
  };
  postApiGovernanceExecute: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  postApiGovernanceProposals: {
    "201": unknown;
  };
  postApiGovernanceVote: {
    "200": unknown;
  };
  postApiHooks: {
    "201": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  postApiJobsProcessDueRecurring: {
    "200": unknown;
    "401": ErrorResponse;
  };
  postApiKeys: {
    "201": {
      success?: true;
      data?: {
        id?: string;
        name?: string;
        prefix?: string;
        scopes?: Array<string>;
        key?: string;
      };
    };
    "400": ErrorResponse;
    "409": unknown;
    "429": ErrorResponse;
  };
  postApiKeysIdRotate: {
    "201": {
      success?: true;
      data?: {
        id?: string;
        name?: string;
        prefix?: string;
        scopes?: Array<string>;
        key?: string;
        previousPrefix?: string;
        previousKeyValidUntil?: string;
      };
    };
    "400": unknown;
    "401": ErrorResponse;
    "403": ErrorResponse;
    "429": ErrorResponse;
    "500": ErrorResponse;
  };
  postApiMultisig: {
    "201": unknown;
  };
  postApiMultisigApprove: {
    "200": unknown;
    "400": ErrorResponse;
  };
  postApiMultisigExecute: {
    "200": unknown;
  };
  postApiMultisigPropose: {
    "201": unknown;
    "400": ErrorResponse;
  };
  postApiPayments: {
    "201": PaymentEnvelopeResponse;
    "400": ProblemDetails;
    "401": ProblemDetails;
    "409": PaymentEnvelopeResponse;
    "500": ProblemDetails;
  };
  postApiPaymentsCancel: {
    "200": unknown;
    "400": ProblemDetails;
    "401": ProblemDetails;
    "404": ProblemDetails;
  };
  postApiPaymentsRetry: {
    "200": PaymentEnvelopeResponse;
    "400": ProblemDetails;
    "401": ProblemDetails;
    "404": ProblemDetails;
    "409": ProblemDetails;
  };
  postApiRbac: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "403": ErrorResponse;
  };
  postApiRecurring: {
    "201": unknown;
    "400": ErrorResponse;
  };
  postApiRefunds: {
    "201": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  postApiRequests: {
    "201": unknown;
    "400": ErrorResponse;
  };
  postApiRequestsIdPaid: {
    "200": unknown;
    "400": ErrorResponse;
    "404": ErrorResponse;
  };
  postApiRequestsIdRemind: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  postApiScheduled: {
    "201": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  postApiScheduledRun: {
    "200": unknown;
    "401": ErrorResponse;
    "503": unknown;
  };
  postApiStreams: {
    "201": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "409": ErrorResponse;
  };
  postApiWebhooks: {
    "201": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  postApiWebhooksIdDeliveriesDeliveryIdRedeliver: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
  postApiWebhooksIdDeliveriesRequeue: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "403": ErrorResponse;
  };
  postApiWebhooksIdReplay: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
  };
  postApiWebhooksIdTest: {
    "200": unknown;
    "400": ErrorResponse;
    "401": ErrorResponse;
    "404": ErrorResponse;
  };
}

// ── Typed operation maps ──────────────────────────────────────
/** Path parameters per operation. */
export interface ApiPathParams {
  deleteApiAuthSession: Record<string, never>;
  deleteApiKeys: Record<string, never>;
  deleteApiPaymentsId: {
    id: string;
  };
  deleteApiScheduled: Record<string, never>;
  deleteApiWebhooks: Record<string, never>;
  getApiAnalytics: Record<string, never>;
  getApiAssetsMetadata: Record<string, never>;
  getApiAuditLog: Record<string, never>;
  getApiAuditLogExport: Record<string, never>;
  getApiAuditLogSse: Record<string, never>;
  getApiAuthChallenge: Record<string, never>;
  getApiBatches: Record<string, never>;
  getApiBatchesId: {
    id: string;
  };
  getApiBatchesSummary: Record<string, never>;
  getApiContracts: Record<string, never>;
  getApiCron: Record<string, never>;
  getApiCsrf: Record<string, never>;
  getApiEscrows: Record<string, never>;
  getApiEscrowsId: {
    id: number;
  };
  getApiEvents: Record<string, never>;
  getApiEventsHistory: Record<string, never>;
  getApiFeeConfig: Record<string, never>;
  getApiFeeConfigCollector: Record<string, never>;
  getApiFeeConfigHistory: Record<string, never>;
  getApiGovernanceProposals: Record<string, never>;
  getApiGovernanceProposalsId: {
    id: number;
  };
  getApiHealth: Record<string, never>;
  getApiHealthLive: Record<string, never>;
  getApiHealthReady: Record<string, never>;
  getApiHooks: Record<string, never>;
  getApiKeys: Record<string, never>;
  getApiKeysStats: Record<string, never>;
  getApiMetrics: Record<string, never>;
  getApiMultisig: Record<string, never>;
  getApiMultisigRequests: Record<string, never>;
  getApiOpenapiJson: Record<string, never>;
  getApiPauseState: Record<string, never>;
  getApiPayments: Record<string, never>;
  getApiPaymentsExport: Record<string, never>;
  getApiPaymentsId: {
    id: string;
  };
  getApiPolicyVersions: Record<string, never>;
  getApiRbac: Record<string, never>;
  getApiRecurring: Record<string, never>;
  getApiRecurringId: {
    id: string;
  };
  getApiRefunds: Record<string, never>;
  getApiRequests: Record<string, never>;
  getApiRequestsExpire: Record<string, never>;
  getApiScheduled: Record<string, never>;
  getApiScheduledRun: Record<string, never>;
  getApiStats: Record<string, never>;
  getApiStreams: Record<string, never>;
  getApiStreamsId: {
    id: number;
  };
  getApiTimelock: Record<string, never>;
  getApiWebhooks: Record<string, never>;
  getApiWebhooksId: {
    id: string;
  };
  getApiWebhooksIdDeliveries: {
    id: string;
  };
  getApiWebhooksIdDeliveriesDeliveryId: {
    id: string;
    deliveryId: string;
  };
  getApiWebhooksIdTest: {
    id: string;
  };
  patchApiHooksId: {
    id: string;
  };
  patchApiKeys: Record<string, never>;
  patchApiPaymentsId: {
    id: string;
  };
  patchApiRecurring: Record<string, never>;
  patchApiRecurringId: {
    id: string;
  };
  patchApiRefundsId: {
    id: string;
  };
  patchApiWebhooks: Record<string, never>;
  postApiAuthSession: Record<string, never>;
  postApiBatches: Record<string, never>;
  postApiBatchesId: {
    id: string;
  };
  postApiCron: Record<string, never>;
  postApiCspReport: Record<string, never>;
  postApiEscrows: Record<string, never>;
  postApiFeeConfig: Record<string, never>;
  postApiGovernanceExecute: Record<string, never>;
  postApiGovernanceProposals: Record<string, never>;
  postApiGovernanceVote: Record<string, never>;
  postApiHooks: Record<string, never>;
  postApiJobsProcessDueRecurring: Record<string, never>;
  postApiKeys: Record<string, never>;
  postApiKeysIdRotate: {
    id: string;
  };
  postApiMultisig: Record<string, never>;
  postApiMultisigApprove: Record<string, never>;
  postApiMultisigExecute: Record<string, never>;
  postApiMultisigPropose: Record<string, never>;
  postApiPayments: Record<string, never>;
  postApiPaymentsCancel: Record<string, never>;
  postApiPaymentsRetry: Record<string, never>;
  postApiRbac: Record<string, never>;
  postApiRecurring: Record<string, never>;
  postApiRefunds: Record<string, never>;
  postApiRequests: Record<string, never>;
  postApiRequestsIdPaid: {
    id: string;
  };
  postApiRequestsIdRemind: {
    id: string;
  };
  postApiScheduled: Record<string, never>;
  postApiScheduledRun: Record<string, never>;
  postApiStreams: Record<string, never>;
  postApiWebhooks: Record<string, never>;
  postApiWebhooksIdDeliveriesDeliveryIdRedeliver: {
    id: string;
    deliveryId: string;
  };
  postApiWebhooksIdDeliveriesRequeue: {
    id: string;
  };
  postApiWebhooksIdReplay: {
    id: string;
  };
  postApiWebhooksIdTest: {
    id: string;
  };
}

// ── Typed operation maps ──────────────────────────────────────
/** Query parameters per operation (required ones are non-optional). */
export interface ApiQueryParams {
  deleteApiAuthSession: Record<string, never>;
  deleteApiKeys: {
    id: string;
  };
  deleteApiPaymentsId: Record<string, never>;
  deleteApiScheduled: {
    id: string;
  };
  deleteApiWebhooks: {
    id: string;
  };
  getApiAnalytics: Record<string, never>;
  getApiAssetsMetadata: {
    code: string;
    issuer: string;
  };
  getApiAuditLog: {
    page?: number;
    limit?: number;
    actor?: string;
    action?: string;
    resource?: number;
    since?: string;
    until?: string;
    order?: "asc" | "desc";
    source?: "contract" | "db" | "all";
  };
  getApiAuditLogExport: {
    actor?: string;
    action?: string;
    resource?: number;
    since?: string;
    until?: string;
    order?: "asc" | "desc";
  };
  getApiAuditLogSse: Record<string, never>;
  getApiAuthChallenge: {
    publicKey: string;
  };
  getApiBatches: {
    page?: number;
    limit?: number;
    cursor?: string;
    status?: string;
    search?: string;
  };
  getApiBatchesId: Record<string, never>;
  getApiBatchesSummary: {
    drillDown?: boolean;
  };
  getApiContracts: Record<string, never>;
  getApiCron: Record<string, never>;
  getApiCsrf: Record<string, never>;
  getApiEscrows: {
    id?: number;
  };
  getApiEscrowsId: Record<string, never>;
  getApiEvents: Record<string, never>;
  getApiEventsHistory: {
    limit?: number;
    cursor?: string;
  };
  getApiFeeConfig: Record<string, never>;
  getApiFeeConfigCollector: Record<string, never>;
  getApiFeeConfigHistory: Record<string, never>;
  getApiGovernanceProposals: Record<string, never>;
  getApiGovernanceProposalsId: Record<string, never>;
  getApiHealth: Record<string, never>;
  getApiHealthLive: Record<string, never>;
  getApiHealthReady: Record<string, never>;
  getApiHooks: {
    event_type?: string;
  };
  getApiKeys: Record<string, never>;
  getApiKeysStats: {
    window?: "24h" | "7d" | "30d";
  };
  getApiMetrics: Record<string, never>;
  getApiMultisig: Record<string, never>;
  getApiMultisigRequests: Record<string, never>;
  getApiOpenapiJson: Record<string, never>;
  getApiPauseState: Record<string, never>;
  getApiPayments: {
    page?: number;
    limit?: number;
    cursor?: string;
    status?: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
    search?: string;
    includeDeleted?: boolean;
  };
  getApiPaymentsExport: {
    status?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    asset?: string;
    format?: "csv" | "json";
  };
  getApiPaymentsId: Record<string, never>;
  getApiPolicyVersions: Record<string, never>;
  getApiRbac: {
    addr?: string;
  };
  getApiRecurring: {
    page?: number;
    limit?: number;
  };
  getApiRecurringId: Record<string, never>;
  getApiRefunds: {
    analytics?: boolean;
  };
  getApiRequests: Record<string, never>;
  getApiRequestsExpire: Record<string, never>;
  getApiScheduled: {
    page?: number;
    limit?: number;
  };
  getApiScheduledRun: Record<string, never>;
  getApiStats: Record<string, never>;
  getApiStreams: {
    id?: number;
  };
  getApiStreamsId: Record<string, never>;
  getApiTimelock: {
    id?: number;
  };
  getApiWebhooks: Record<string, never>;
  getApiWebhooksId: Record<string, never>;
  getApiWebhooksIdDeliveries: {
    limit?: number;
  };
  getApiWebhooksIdDeliveriesDeliveryId: Record<string, never>;
  getApiWebhooksIdTest: {
    event?: string;
    timestamp?: string;
  };
  patchApiHooksId: Record<string, never>;
  patchApiKeys: Record<string, never>;
  patchApiPaymentsId: Record<string, never>;
  patchApiRecurring: Record<string, never>;
  patchApiRecurringId: Record<string, never>;
  patchApiRefundsId: Record<string, never>;
  patchApiWebhooks: {
    id: string;
  };
  postApiAuthSession: Record<string, never>;
  postApiBatches: Record<string, never>;
  postApiBatchesId: Record<string, never>;
  postApiCron: Record<string, never>;
  postApiCspReport: Record<string, never>;
  postApiEscrows: Record<string, never>;
  postApiFeeConfig: Record<string, never>;
  postApiGovernanceExecute: Record<string, never>;
  postApiGovernanceProposals: Record<string, never>;
  postApiGovernanceVote: Record<string, never>;
  postApiHooks: Record<string, never>;
  postApiJobsProcessDueRecurring: Record<string, never>;
  postApiKeys: Record<string, never>;
  postApiKeysIdRotate: Record<string, never>;
  postApiMultisig: Record<string, never>;
  postApiMultisigApprove: Record<string, never>;
  postApiMultisigExecute: Record<string, never>;
  postApiMultisigPropose: Record<string, never>;
  postApiPayments: Record<string, never>;
  postApiPaymentsCancel: Record<string, never>;
  postApiPaymentsRetry: Record<string, never>;
  postApiRbac: Record<string, never>;
  postApiRecurring: Record<string, never>;
  postApiRefunds: Record<string, never>;
  postApiRequests: Record<string, never>;
  postApiRequestsIdPaid: Record<string, never>;
  postApiRequestsIdRemind: Record<string, never>;
  postApiScheduled: Record<string, never>;
  postApiScheduledRun: Record<string, never>;
  postApiStreams: Record<string, never>;
  postApiWebhooks: Record<string, never>;
  postApiWebhooksIdDeliveriesDeliveryIdRedeliver: Record<string, never>;
  postApiWebhooksIdDeliveriesRequeue: Record<string, never>;
  postApiWebhooksIdReplay: Record<string, never>;
  postApiWebhooksIdTest: Record<string, never>;
}

// ── Typed operation maps ──────────────────────────────────────
/** Header parameters per operation (e.g. `Idempotency-Key`). */
export interface ApiHeaderParams {
  deleteApiAuthSession: Record<string, never>;
  deleteApiKeys: Record<string, never>;
  deleteApiPaymentsId: Record<string, never>;
  deleteApiScheduled: Record<string, never>;
  deleteApiWebhooks: Record<string, never>;
  getApiAnalytics: Record<string, never>;
  getApiAssetsMetadata: Record<string, never>;
  getApiAuditLog: Record<string, never>;
  getApiAuditLogExport: Record<string, never>;
  getApiAuditLogSse: Record<string, never>;
  getApiAuthChallenge: Record<string, never>;
  getApiBatches: Record<string, never>;
  getApiBatchesId: Record<string, never>;
  getApiBatchesSummary: Record<string, never>;
  getApiContracts: Record<string, never>;
  getApiCron: Record<string, never>;
  getApiCsrf: Record<string, never>;
  getApiEscrows: Record<string, never>;
  getApiEscrowsId: Record<string, never>;
  getApiEvents: Record<string, never>;
  getApiEventsHistory: Record<string, never>;
  getApiFeeConfig: Record<string, never>;
  getApiFeeConfigCollector: Record<string, never>;
  getApiFeeConfigHistory: Record<string, never>;
  getApiGovernanceProposals: Record<string, never>;
  getApiGovernanceProposalsId: Record<string, never>;
  getApiHealth: Record<string, never>;
  getApiHealthLive: Record<string, never>;
  getApiHealthReady: Record<string, never>;
  getApiHooks: Record<string, never>;
  getApiKeys: Record<string, never>;
  getApiKeysStats: Record<string, never>;
  getApiMetrics: Record<string, never>;
  getApiMultisig: Record<string, never>;
  getApiMultisigRequests: Record<string, never>;
  getApiOpenapiJson: Record<string, never>;
  getApiPauseState: Record<string, never>;
  getApiPayments: Record<string, never>;
  getApiPaymentsExport: Record<string, never>;
  getApiPaymentsId: Record<string, never>;
  getApiPolicyVersions: Record<string, never>;
  getApiRbac: Record<string, never>;
  getApiRecurring: Record<string, never>;
  getApiRecurringId: Record<string, never>;
  getApiRefunds: Record<string, never>;
  getApiRequests: Record<string, never>;
  getApiRequestsExpire: Record<string, never>;
  getApiScheduled: Record<string, never>;
  getApiScheduledRun: Record<string, never>;
  getApiStats: Record<string, never>;
  getApiStreams: Record<string, never>;
  getApiStreamsId: Record<string, never>;
  getApiTimelock: Record<string, never>;
  getApiWebhooks: Record<string, never>;
  getApiWebhooksId: Record<string, never>;
  getApiWebhooksIdDeliveries: Record<string, never>;
  getApiWebhooksIdDeliveriesDeliveryId: Record<string, never>;
  getApiWebhooksIdTest: Record<string, never>;
  patchApiHooksId: Record<string, never>;
  patchApiKeys: Record<string, never>;
  patchApiPaymentsId: Record<string, never>;
  patchApiRecurring: Record<string, never>;
  patchApiRecurringId: Record<string, never>;
  patchApiRefundsId: Record<string, never>;
  patchApiWebhooks: Record<string, never>;
  postApiAuthSession: Record<string, never>;
  postApiBatches: {
    "Idempotency-Key": string;
  };
  postApiBatchesId: Record<string, never>;
  postApiCron: Record<string, never>;
  postApiCspReport: Record<string, never>;
  postApiEscrows: {
    "Idempotency-Key": string;
  };
  postApiFeeConfig: Record<string, never>;
  postApiGovernanceExecute: Record<string, never>;
  postApiGovernanceProposals: Record<string, never>;
  postApiGovernanceVote: Record<string, never>;
  postApiHooks: Record<string, never>;
  postApiJobsProcessDueRecurring: Record<string, never>;
  postApiKeys: Record<string, never>;
  postApiKeysIdRotate: Record<string, never>;
  postApiMultisig: Record<string, never>;
  postApiMultisigApprove: Record<string, never>;
  postApiMultisigExecute: Record<string, never>;
  postApiMultisigPropose: Record<string, never>;
  postApiPayments: {
    "Idempotency-Key": string;
  };
  postApiPaymentsCancel: Record<string, never>;
  postApiPaymentsRetry: Record<string, never>;
  postApiRbac: Record<string, never>;
  postApiRecurring: Record<string, never>;
  postApiRefunds: Record<string, never>;
  postApiRequests: Record<string, never>;
  postApiRequestsIdPaid: Record<string, never>;
  postApiRequestsIdRemind: Record<string, never>;
  postApiScheduled: Record<string, never>;
  postApiScheduledRun: Record<string, never>;
  postApiStreams: {
    "Idempotency-Key": string;
  };
  postApiWebhooks: Record<string, never>;
  postApiWebhooksIdDeliveriesDeliveryIdRedeliver: Record<string, never>;
  postApiWebhooksIdDeliveriesRequeue: Record<string, never>;
  postApiWebhooksIdReplay: Record<string, never>;
  postApiWebhooksIdTest: Record<string, never>;
}

