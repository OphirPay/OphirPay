// SPDX-License-Identifier: MIT
// GENERATED FROM docs/openapi.yaml — DO NOT EDIT BY HAND.
// Regenerate with: npm run client:generate (or npm run generate:sdk)

// ══════════════════════════════════════════════════════════════════
// 1. Operation Metadata & Catalogue
// ══════════════════════════════════════════════════════════════════

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
  | "postApiFeeConfig"
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
  | "postApiRbac"
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

export declare const API_OPERATIONS: ReadonlyArray<ApiOperation>;
export declare const OPERATION_BY_NAME: Record<ApiOperationName, ApiOperation>;

// ══════════════════════════════════════════════════════════════════
// 2. Components Schemas (OpenAPI Models)
// ══════════════════════════════════════════════════════════════════

export interface AssetMetadata {
  code?: string;
  issuer?: string;
  name?: unknown;
  description?: unknown;
  image?: unknown;
  decimals?: unknown;
  orgName?: unknown;
  homeDomain?: unknown;
  source?: "toml" | "cache" | "fallback";
  fetchedAt?: string;
}

export interface PaymentResponse {
  id?: string;
  amount?: number;
  assetCode?: string;
  assetIssuer?: unknown;
  description?: unknown;
  memo?: unknown;
  status?: string;
  transactionHash?: unknown;
  idempotencyKey?: unknown;
  sourceAccountId?: string;
  userId?: string;
  batchId?: unknown;
  createdAt?: string;
  completedAt?: unknown;
  errorMessage?: unknown;
}

export interface PaymentEnvelopeResponse {
  success?: boolean;
  data?: PaymentResponse;
  meta?: {
    timestamp?: string;
  };
}

export interface PaginatedPayments {
  success?: boolean;
  data?: Array<PaymentResponse>;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    nextCursor?: unknown;
    hasMore?: boolean;
  };
}

export interface BatchResponse {
  id?: string;
  userId?: string;
  name?: string;
  description?: unknown;
  status?: "CREATED" | "PROCESSING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED";
  createdAt?: string;
  updatedAt?: string;
  payments?: Array<PaymentResponse>;
}

export interface BulkCancelBatchResponse {
  success?: boolean;
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

export interface PaginatedBatches {
  success?: boolean;
  data?: Array<BatchResponse>;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    nextCursor?: unknown;
    hasMore?: boolean;
  };
}

export interface CreatePaymentRequestSchema {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  recipientAddress?: string;
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

export interface TestWebhookResponse {
  delivered?: boolean;
  status?: "delivered" | "failed";
  event?: string;
  test?: boolean;
  durationMs?: number;
  sentAt?: string;
}

export interface HealthResponse {
  success?: boolean;
  data?: {
    version?: string;
    status?: "ok" | "degraded" | "down";
    services?: {
      database?: {
        status?: "ok" | "error";
        latencyMs?: unknown;
      };
      redis?: {
        status?: "ok" | "error" | "disabled";
        latencyMs?: unknown;
      };
      stellar?: {
        network?: string;
        rpcUrl?: string;
        horizonUrl?: string;
        rpc?: {
          status?: "ok" | "error" | "unchecked";
          latencyMs?: unknown;
        };
        horizon?: {
          status?: "ok" | "error" | "unchecked";
          latencyMs?: unknown;
        };
        contracts?: {
          status?: "ok" | "error";
          ophirpay?: {
            id?: unknown;
            status?: "ok" | "error" | "not_configured";
          };
          emitter?: {
            id?: unknown;
            status?: "ok" | "error" | "not_configured";
          };
          chainReadSource?: {
            id?: unknown;
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

export interface ErrorResponse {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface ProblemFieldError {
  field: string;
  message: string;
  code?: string;
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


// ══════════════════════════════════════════════════════════════════
// 3. Typed Request / Response Interfaces (97 Operations)
// ══════════════════════════════════════════════════════════════════

export type DeleteApiAuthSessionResponse = unknown;

export interface DeleteApiKeysQuery {
  id: string;
}

export type DeleteApiKeysResponse = unknown;

export interface DeleteApiPaymentsIdParams {
  id: string;
}

export type DeleteApiPaymentsIdResponse = unknown;

export interface DeleteApiScheduledQuery {
  id: string;
}

export type DeleteApiScheduledResponse = unknown;

export interface DeleteApiWebhooksQuery {
  id: string;
}

export type DeleteApiWebhooksResponse = unknown;

export type GetApiAnalyticsResponse = {
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

export interface GetApiAssetsMetadataQuery {
  code: string;
  issuer: string;
}

export type GetApiAssetsMetadataResponse = {
  success?: boolean;
  data?: AssetMetadata;
};

export interface GetApiAuditLogQuery {
  page?: number;
  limit?: number;
  actor?: string;
  action?: string;
  resource?: number;
  since?: string;
  until?: string;
  order?: "asc" | "desc";
  source?: "contract" | "db" | "all";
}

export type GetApiAuditLogResponse = unknown;

export interface GetApiAuditLogExportQuery {
  actor?: string;
  action?: string;
  resource?: number;
  since?: string;
  until?: string;
  order?: "asc" | "desc";
}

export type GetApiAuditLogExportResponse = unknown;

export type GetApiAuditLogSseResponse = unknown;

export interface GetApiAuthChallengeQuery {
  publicKey: string;
}

export type GetApiAuthChallengeResponse = {
  challenge: string;
  message: string;
  expiresIn: number;
};

export interface GetApiBatchesQuery {
  page?: number;
  limit?: number;
  cursor?: string;
  status?: string;
  search?: string;
}

export type GetApiBatchesResponse = PaginatedBatches;

export interface GetApiBatchesIdParams {
  id: string;
}

export type GetApiBatchesIdResponse = unknown;

export interface GetApiBatchesSummaryQuery {
  drillDown?: boolean;
}

export type GetApiBatchesSummaryResponse = unknown;

export type GetApiContractsResponse = unknown;

export type GetApiCronResponse = unknown;

export type GetApiCsrfResponse = unknown;

export interface GetApiEscrowsQuery {
  id?: number;
}

export type GetApiEscrowsResponse = unknown;

export interface GetApiEscrowsIdParams {
  id: number;
}

export type GetApiEscrowsIdResponse = unknown;

export type GetApiEventsResponse = unknown;

export interface GetApiEventsHistoryQuery {
  limit?: number;
  cursor?: string;
}

export type GetApiEventsHistoryResponse = unknown;

export type GetApiFeeConfigResponse = unknown;

export type GetApiFeeConfigCollectorResponse = unknown;

export type GetApiFeeConfigHistoryResponse = unknown;

export type GetApiGovernanceProposalsResponse = {
  success?: boolean;
  data?: {
    items?: Array<{
      id?: number;
      title?: string;
      description?: string;
      action_type?: string;
      yes_votes?: number;
      no_votes?: number;
      voting_ends_at?: unknown;
      executed?: boolean;
      proposer?: string;
    }>;
    total?: number;
    truncated?: boolean;
  };
};

export interface GetApiGovernanceProposalsIdParams {
  id: number;
}

export type GetApiGovernanceProposalsIdResponse = {
  success?: boolean;
  data?: {
    proposal?: unknown;
    config?: unknown;
    voteHistory?: Array<{
      voter?: unknown;
      support?: unknown;
      transactionHash?: unknown;
      recordedAt?: string;
    }>;
  };
};

export type GetApiHealthResponse = HealthResponse;

export type GetApiHealthLiveResponse = {
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

export interface GetApiHooksQuery {
  event_type?: string;
}

export type GetApiHooksResponse = unknown;

export type GetApiKeysResponse = unknown;

export interface GetApiKeysStatsQuery {
  window?: "24h" | "7d" | "30d";
}

export type GetApiKeysStatsResponse = unknown;

export type GetApiMetricsResponse = unknown;

export type GetApiMultisigResponse = {
  success?: boolean;
  data?: {
    threshold?: number;
    signers?: Array<string>;
    enabled?: boolean;
  };
};

export type GetApiMultisigRequestsResponse = unknown;

export type GetApiPauseStateResponse = unknown;

export interface GetApiPaymentsQuery {
  page?: number;
  limit?: number;
  cursor?: string;
  status?: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  search?: string;
  includeDeleted?: boolean;
}

export type GetApiPaymentsResponse = PaginatedPayments;

export interface GetApiPaymentsExportQuery {
  status?: string;
  search?: string;
}

export type GetApiPaymentsExportResponse = unknown;

export interface GetApiPaymentsIdParams {
  id: string;
}

export type GetApiPaymentsIdResponse = PaymentEnvelopeResponse;

export type GetApiPolicyVersionsResponse = unknown;

export interface GetApiRbacQuery {
  addr?: string;
}

export type GetApiRbacResponse = unknown;

export interface GetApiRecurringQuery {
  page?: number;
  limit?: number;
}

export type GetApiRecurringResponse = unknown;

export interface GetApiRecurringIdParams {
  id: string;
}

export type GetApiRecurringIdResponse = unknown;

export interface GetApiRefundsQuery {
  analytics?: boolean;
}

export type GetApiRefundsResponse = unknown;

export type GetApiRequestsResponse = unknown;

export type GetApiRequestsExpireResponse = unknown;

export interface GetApiScheduledQuery {
  page?: number;
  limit?: number;
}

export type GetApiScheduledResponse = unknown;

export type GetApiScheduledRunResponse = unknown;

export type GetApiStatsResponse = unknown;

export interface GetApiStreamsQuery {
  id?: number;
}

export type GetApiStreamsResponse = unknown;

export interface GetApiStreamsIdParams {
  id: number;
}

export type GetApiStreamsIdResponse = unknown;

export interface GetApiTimelockQuery {
  id?: number;
}

export type GetApiTimelockResponse = unknown;

export type GetApiWebhooksResponse = unknown;

export interface GetApiWebhooksIdParams {
  id: string;
}

export type GetApiWebhooksIdResponse = unknown;

export interface GetApiWebhooksIdDeliveriesParams {
  id: string;
}

export interface GetApiWebhooksIdDeliveriesQuery {
  limit?: number;
}

export type GetApiWebhooksIdDeliveriesResponse = unknown;

export interface GetApiWebhooksIdDeliveriesDeliveryIdParams {
  id: string;
  deliveryId: string;
}

export type GetApiWebhooksIdDeliveriesDeliveryIdResponse = unknown;

export interface GetApiWebhooksIdTestParams {
  id: string;
}

export interface GetApiWebhooksIdTestQuery {
  event?: string;
  timestamp?: string;
}

export type GetApiWebhooksIdTestResponse = unknown;

export interface PatchApiHooksIdParams {
  id: string;
}

export type PatchApiHooksIdBody = {
  active: boolean;
};

export type PatchApiHooksIdResponse = unknown;

export type PatchApiKeysBody = {
  id: string;
  scopes: Array<"read:payments" | "write:payments" | "read:analytics" | "admin">;
};

export type PatchApiKeysResponse = unknown;

export interface PatchApiPaymentsIdParams {
  id: string;
}

export type PatchApiPaymentsIdBody = {
  status?: "CREATED" | "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  description?: string;
  memo?: string;
};

export type PatchApiPaymentsIdResponse = unknown;

export type PatchApiRecurringBody = {
  id: string;
  paused: boolean;
};

export type PatchApiRecurringResponse = unknown;

export interface PatchApiRecurringIdParams {
  id: string;
}

export type PatchApiRecurringIdResponse = unknown;

export interface PatchApiRefundsIdParams {
  id: string;
}

export type PatchApiRefundsIdBody = {
  status: "APPROVED" | "PROCESSED" | "REJECTED";
};

export type PatchApiRefundsIdResponse = unknown;

export interface PatchApiWebhooksQuery {
  id: string;
}

export type PatchApiWebhooksResponse = unknown;

export type PostApiAuthSessionBody = {
  publicKey: string;
  signature: string;
};

export type PostApiAuthSessionResponse = unknown;

export type PostApiBatchesBody = CreateBatchRequest;

export type PostApiBatchesResponse = unknown;

export interface PostApiBatchesIdParams {
  id: string;
}

export type PostApiBatchesIdResponse = BulkCancelBatchResponse;

export type PostApiCronResponse = unknown;

export type PostApiCspReportResponse = void;

export type PostApiEscrowsBody = {
  payee: string;
  amount: number;
  assetCode?: string;
  releaseAfter?: number;
  releaseTo?: string;
  memo?: string;
};

export type PostApiEscrowsResponse = unknown;

export type PostApiFeeConfigBody = {
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

export type PostApiFeeConfigResponse = unknown;

export type PostApiGovernanceExecuteBody = {
  proposalId: number;
};

export type PostApiGovernanceExecuteResponse = unknown;

export type PostApiGovernanceProposalsBody = {
  proposer: string;
  title: string;
  description?: string;
  actionType?: string;
  target?: string;
  data?: string;
  depositAsset?: string;
  depositAmount?: number;
};

export type PostApiGovernanceProposalsResponse = unknown;

export type PostApiGovernanceVoteBody = {
  proposalId: number;
  voter: string;
  support?: boolean;
};

export type PostApiGovernanceVoteResponse = unknown;

export type PostApiHooksBody = {
  eventType: string;
  webhookUrl: string;
  onChainId?: number;
};

export type PostApiHooksResponse = unknown;

export type PostApiJobsProcessDueRecurringBody = {
  limit?: number;
};

export type PostApiJobsProcessDueRecurringResponse = unknown;

export type PostApiKeysBody = {
  name: string;
  scopes?: Array<"read:payments" | "write:payments" | "read:analytics" | "admin">;
};

export type PostApiKeysResponse = {
  success?: boolean;
  data?: {
    id?: string;
    name?: string;
    prefix?: string;
    scopes?: Array<string>;
    key?: string;
  };
};

export interface PostApiKeysIdRotateParams {
  id: string;
}

export type PostApiKeysIdRotateResponse = {
  success?: boolean;
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

export type PostApiMultisigBody = {
  threshold?: number;
  signers?: Array<string>;
  enabled?: boolean;
};

export type PostApiMultisigResponse = unknown;

export type PostApiMultisigApproveBody = {
  requestId: number;
};

export type PostApiMultisigApproveResponse = unknown;

export type PostApiMultisigExecuteBody = {
  requestId: number;
};

export type PostApiMultisigExecuteResponse = unknown;

export type PostApiMultisigProposeBody = {
  payee: string;
  amount: number;
  assetCode?: string;
  memo?: string;
};

export type PostApiMultisigProposeResponse = unknown;

export type PostApiPaymentsBody = CreatePaymentRequest;

export type PostApiPaymentsResponse = PaymentEnvelopeResponse;

export type PostApiPaymentsCancelBody = {
  txHash: string;
};

export type PostApiPaymentsCancelResponse = unknown;

export type PostApiPaymentsRetryBody = {
  id: string;
};

export type PostApiPaymentsRetryResponse = PaymentEnvelopeResponse;

export type PostApiRbacBody = {
  action: "grant" | "revoke";
  address: string;
  role?: number;
  challenge?: string;
  signature?: string;
};

export type PostApiRbacResponse = unknown;

export type PostApiRecurringBody = CreateRecurrenceRequest;

export type PostApiRecurringResponse = unknown;

export type PostApiRefundsBody = {
  paymentId: number;
  amount: number;
  asset?: string;
  reason?: string;
  reasonCode?: number;
  onChainId?: number;
};

export type PostApiRefundsResponse = unknown;

export type PostApiRequestsBody = CreatePaymentRequestSchema;

export type PostApiRequestsResponse = unknown;

export interface PostApiRequestsIdPaidParams {
  id: string;
}

export type PostApiRequestsIdPaidBody = {
  transactionHash: string;
};

export type PostApiRequestsIdPaidResponse = unknown;

export interface PostApiRequestsIdRemindParams {
  id: string;
}

export type PostApiRequestsIdRemindResponse = unknown;

export type PostApiScheduledBody = {
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  destAddress: string;
  memo?: string;
  scheduledAt: string;
};

export type PostApiScheduledResponse = unknown;

export type PostApiScheduledRunResponse = unknown;

export type PostApiStreamsBody = {
  payee: string;
  amount: number;
  assetCode?: string;
  startTime?: number;
  endTime?: number;
  memo?: string;
};

export type PostApiStreamsResponse = unknown;

export type PostApiWebhooksBody = CreateWebhookRequest;

export type PostApiWebhooksResponse = unknown;

export interface PostApiWebhooksIdDeliveriesDeliveryIdRedeliverParams {
  id: string;
  deliveryId: string;
}

export type PostApiWebhooksIdDeliveriesDeliveryIdRedeliverResponse = unknown;

export interface PostApiWebhooksIdReplayParams {
  id: string;
}

export type PostApiWebhooksIdReplayBody = {
  since?: string;
  until?: string;
  limit?: number;
};

export type PostApiWebhooksIdReplayResponse = unknown;

export interface PostApiWebhooksIdTestParams {
  id: string;
}

export type PostApiWebhooksIdTestResponse = unknown;

// ══════════════════════════════════════════════════════════════════
// 4. Unified Operation & Route Type Maps
// ══════════════════════════════════════════════════════════════════

export interface OperationTypesMap {
  "deleteApiAuthSession": {
    method: "DELETE";
    path: "/api/auth/session";
    params: never;
    query: never;
    body: never;
    response: DeleteApiAuthSessionResponse;
  };
  "deleteApiKeys": {
    method: "DELETE";
    path: "/api/keys";
    params: never;
    query: DeleteApiKeysQuery;
    body: never;
    response: DeleteApiKeysResponse;
  };
  "deleteApiPaymentsId": {
    method: "DELETE";
    path: "/api/payments/{id}";
    params: DeleteApiPaymentsIdParams;
    query: never;
    body: never;
    response: DeleteApiPaymentsIdResponse;
  };
  "deleteApiScheduled": {
    method: "DELETE";
    path: "/api/scheduled";
    params: never;
    query: DeleteApiScheduledQuery;
    body: never;
    response: DeleteApiScheduledResponse;
  };
  "deleteApiWebhooks": {
    method: "DELETE";
    path: "/api/webhooks";
    params: never;
    query: DeleteApiWebhooksQuery;
    body: never;
    response: DeleteApiWebhooksResponse;
  };
  "getApiAnalytics": {
    method: "GET";
    path: "/api/analytics";
    params: never;
    query: never;
    body: never;
    response: GetApiAnalyticsResponse;
  };
  "getApiAssetsMetadata": {
    method: "GET";
    path: "/api/assets/metadata";
    params: never;
    query: GetApiAssetsMetadataQuery;
    body: never;
    response: GetApiAssetsMetadataResponse;
  };
  "getApiAuditLog": {
    method: "GET";
    path: "/api/audit-log";
    params: never;
    query: GetApiAuditLogQuery;
    body: never;
    response: GetApiAuditLogResponse;
  };
  "getApiAuditLogExport": {
    method: "GET";
    path: "/api/audit-log/export";
    params: never;
    query: GetApiAuditLogExportQuery;
    body: never;
    response: GetApiAuditLogExportResponse;
  };
  "getApiAuditLogSse": {
    method: "GET";
    path: "/api/audit-log/sse";
    params: never;
    query: never;
    body: never;
    response: GetApiAuditLogSseResponse;
  };
  "getApiAuthChallenge": {
    method: "GET";
    path: "/api/auth/challenge";
    params: never;
    query: GetApiAuthChallengeQuery;
    body: never;
    response: GetApiAuthChallengeResponse;
  };
  "getApiBatches": {
    method: "GET";
    path: "/api/batches";
    params: never;
    query: GetApiBatchesQuery;
    body: never;
    response: GetApiBatchesResponse;
  };
  "getApiBatchesId": {
    method: "GET";
    path: "/api/batches/{id}";
    params: GetApiBatchesIdParams;
    query: never;
    body: never;
    response: GetApiBatchesIdResponse;
  };
  "getApiBatchesSummary": {
    method: "GET";
    path: "/api/batches/summary";
    params: never;
    query: GetApiBatchesSummaryQuery;
    body: never;
    response: GetApiBatchesSummaryResponse;
  };
  "getApiContracts": {
    method: "GET";
    path: "/api/contracts";
    params: never;
    query: never;
    body: never;
    response: GetApiContractsResponse;
  };
  "getApiCron": {
    method: "GET";
    path: "/api/cron";
    params: never;
    query: never;
    body: never;
    response: GetApiCronResponse;
  };
  "getApiCsrf": {
    method: "GET";
    path: "/api/csrf";
    params: never;
    query: never;
    body: never;
    response: GetApiCsrfResponse;
  };
  "getApiEscrows": {
    method: "GET";
    path: "/api/escrows";
    params: never;
    query: GetApiEscrowsQuery;
    body: never;
    response: GetApiEscrowsResponse;
  };
  "getApiEscrowsId": {
    method: "GET";
    path: "/api/escrows/{id}";
    params: GetApiEscrowsIdParams;
    query: never;
    body: never;
    response: GetApiEscrowsIdResponse;
  };
  "getApiEvents": {
    method: "GET";
    path: "/api/events";
    params: never;
    query: never;
    body: never;
    response: GetApiEventsResponse;
  };
  "getApiEventsHistory": {
    method: "GET";
    path: "/api/events/history";
    params: never;
    query: GetApiEventsHistoryQuery;
    body: never;
    response: GetApiEventsHistoryResponse;
  };
  "getApiFeeConfig": {
    method: "GET";
    path: "/api/fee-config";
    params: never;
    query: never;
    body: never;
    response: GetApiFeeConfigResponse;
  };
  "getApiFeeConfigCollector": {
    method: "GET";
    path: "/api/fee-config/collector";
    params: never;
    query: never;
    body: never;
    response: GetApiFeeConfigCollectorResponse;
  };
  "getApiFeeConfigHistory": {
    method: "GET";
    path: "/api/fee-config/history";
    params: never;
    query: never;
    body: never;
    response: GetApiFeeConfigHistoryResponse;
  };
  "getApiGovernanceProposals": {
    method: "GET";
    path: "/api/governance/proposals";
    params: never;
    query: never;
    body: never;
    response: GetApiGovernanceProposalsResponse;
  };
  "getApiGovernanceProposalsId": {
    method: "GET";
    path: "/api/governance/proposals/{id}";
    params: GetApiGovernanceProposalsIdParams;
    query: never;
    body: never;
    response: GetApiGovernanceProposalsIdResponse;
  };
  "getApiHealth": {
    method: "GET";
    path: "/api/health";
    params: never;
    query: never;
    body: never;
    response: GetApiHealthResponse;
  };
  "getApiHealthLive": {
    method: "GET";
    path: "/api/health/live";
    params: never;
    query: never;
    body: never;
    response: GetApiHealthLiveResponse;
  };
  "getApiHooks": {
    method: "GET";
    path: "/api/hooks";
    params: never;
    query: GetApiHooksQuery;
    body: never;
    response: GetApiHooksResponse;
  };
  "getApiKeys": {
    method: "GET";
    path: "/api/keys";
    params: never;
    query: never;
    body: never;
    response: GetApiKeysResponse;
  };
  "getApiKeysStats": {
    method: "GET";
    path: "/api/keys/stats";
    params: never;
    query: GetApiKeysStatsQuery;
    body: never;
    response: GetApiKeysStatsResponse;
  };
  "getApiMetrics": {
    method: "GET";
    path: "/api/metrics";
    params: never;
    query: never;
    body: never;
    response: GetApiMetricsResponse;
  };
  "getApiMultisig": {
    method: "GET";
    path: "/api/multisig";
    params: never;
    query: never;
    body: never;
    response: GetApiMultisigResponse;
  };
  "getApiMultisigRequests": {
    method: "GET";
    path: "/api/multisig/requests";
    params: never;
    query: never;
    body: never;
    response: GetApiMultisigRequestsResponse;
  };
  "getApiPauseState": {
    method: "GET";
    path: "/api/pause-state";
    params: never;
    query: never;
    body: never;
    response: GetApiPauseStateResponse;
  };
  "getApiPayments": {
    method: "GET";
    path: "/api/payments";
    params: never;
    query: GetApiPaymentsQuery;
    body: never;
    response: GetApiPaymentsResponse;
  };
  "getApiPaymentsExport": {
    method: "GET";
    path: "/api/payments/export";
    params: never;
    query: GetApiPaymentsExportQuery;
    body: never;
    response: GetApiPaymentsExportResponse;
  };
  "getApiPaymentsId": {
    method: "GET";
    path: "/api/payments/{id}";
    params: GetApiPaymentsIdParams;
    query: never;
    body: never;
    response: GetApiPaymentsIdResponse;
  };
  "getApiPolicyVersions": {
    method: "GET";
    path: "/api/policy-versions";
    params: never;
    query: never;
    body: never;
    response: GetApiPolicyVersionsResponse;
  };
  "getApiRbac": {
    method: "GET";
    path: "/api/rbac";
    params: never;
    query: GetApiRbacQuery;
    body: never;
    response: GetApiRbacResponse;
  };
  "getApiRecurring": {
    method: "GET";
    path: "/api/recurring";
    params: never;
    query: GetApiRecurringQuery;
    body: never;
    response: GetApiRecurringResponse;
  };
  "getApiRecurringId": {
    method: "GET";
    path: "/api/recurring/{id}";
    params: GetApiRecurringIdParams;
    query: never;
    body: never;
    response: GetApiRecurringIdResponse;
  };
  "getApiRefunds": {
    method: "GET";
    path: "/api/refunds";
    params: never;
    query: GetApiRefundsQuery;
    body: never;
    response: GetApiRefundsResponse;
  };
  "getApiRequests": {
    method: "GET";
    path: "/api/requests";
    params: never;
    query: never;
    body: never;
    response: GetApiRequestsResponse;
  };
  "getApiRequestsExpire": {
    method: "GET";
    path: "/api/requests/expire";
    params: never;
    query: never;
    body: never;
    response: GetApiRequestsExpireResponse;
  };
  "getApiScheduled": {
    method: "GET";
    path: "/api/scheduled";
    params: never;
    query: GetApiScheduledQuery;
    body: never;
    response: GetApiScheduledResponse;
  };
  "getApiScheduledRun": {
    method: "GET";
    path: "/api/scheduled/run";
    params: never;
    query: never;
    body: never;
    response: GetApiScheduledRunResponse;
  };
  "getApiStats": {
    method: "GET";
    path: "/api/stats";
    params: never;
    query: never;
    body: never;
    response: GetApiStatsResponse;
  };
  "getApiStreams": {
    method: "GET";
    path: "/api/streams";
    params: never;
    query: GetApiStreamsQuery;
    body: never;
    response: GetApiStreamsResponse;
  };
  "getApiStreamsId": {
    method: "GET";
    path: "/api/streams/{id}";
    params: GetApiStreamsIdParams;
    query: never;
    body: never;
    response: GetApiStreamsIdResponse;
  };
  "getApiTimelock": {
    method: "GET";
    path: "/api/timelock";
    params: never;
    query: GetApiTimelockQuery;
    body: never;
    response: GetApiTimelockResponse;
  };
  "getApiWebhooks": {
    method: "GET";
    path: "/api/webhooks";
    params: never;
    query: never;
    body: never;
    response: GetApiWebhooksResponse;
  };
  "getApiWebhooksId": {
    method: "GET";
    path: "/api/webhooks/{id}";
    params: GetApiWebhooksIdParams;
    query: never;
    body: never;
    response: GetApiWebhooksIdResponse;
  };
  "getApiWebhooksIdDeliveries": {
    method: "GET";
    path: "/api/webhooks/{id}/deliveries";
    params: GetApiWebhooksIdDeliveriesParams;
    query: GetApiWebhooksIdDeliveriesQuery;
    body: never;
    response: GetApiWebhooksIdDeliveriesResponse;
  };
  "getApiWebhooksIdDeliveriesDeliveryId": {
    method: "GET";
    path: "/api/webhooks/{id}/deliveries/{deliveryId}";
    params: GetApiWebhooksIdDeliveriesDeliveryIdParams;
    query: never;
    body: never;
    response: GetApiWebhooksIdDeliveriesDeliveryIdResponse;
  };
  "getApiWebhooksIdTest": {
    method: "GET";
    path: "/api/webhooks/{id}/test";
    params: GetApiWebhooksIdTestParams;
    query: GetApiWebhooksIdTestQuery;
    body: never;
    response: GetApiWebhooksIdTestResponse;
  };
  "patchApiHooksId": {
    method: "PATCH";
    path: "/api/hooks/{id}";
    params: PatchApiHooksIdParams;
    query: never;
    body: PatchApiHooksIdBody;
    response: PatchApiHooksIdResponse;
  };
  "patchApiKeys": {
    method: "PATCH";
    path: "/api/keys";
    params: never;
    query: never;
    body: PatchApiKeysBody;
    response: PatchApiKeysResponse;
  };
  "patchApiPaymentsId": {
    method: "PATCH";
    path: "/api/payments/{id}";
    params: PatchApiPaymentsIdParams;
    query: never;
    body: PatchApiPaymentsIdBody;
    response: PatchApiPaymentsIdResponse;
  };
  "patchApiRecurring": {
    method: "PATCH";
    path: "/api/recurring";
    params: never;
    query: never;
    body: PatchApiRecurringBody;
    response: PatchApiRecurringResponse;
  };
  "patchApiRecurringId": {
    method: "PATCH";
    path: "/api/recurring/{id}";
    params: PatchApiRecurringIdParams;
    query: never;
    body: never;
    response: PatchApiRecurringIdResponse;
  };
  "patchApiRefundsId": {
    method: "PATCH";
    path: "/api/refunds/{id}";
    params: PatchApiRefundsIdParams;
    query: never;
    body: PatchApiRefundsIdBody;
    response: PatchApiRefundsIdResponse;
  };
  "patchApiWebhooks": {
    method: "PATCH";
    path: "/api/webhooks";
    params: never;
    query: PatchApiWebhooksQuery;
    body: never;
    response: PatchApiWebhooksResponse;
  };
  "postApiAuthSession": {
    method: "POST";
    path: "/api/auth/session";
    params: never;
    query: never;
    body: PostApiAuthSessionBody;
    response: PostApiAuthSessionResponse;
  };
  "postApiBatches": {
    method: "POST";
    path: "/api/batches";
    params: never;
    query: never;
    body: PostApiBatchesBody;
    response: PostApiBatchesResponse;
  };
  "postApiBatchesId": {
    method: "POST";
    path: "/api/batches/{id}";
    params: PostApiBatchesIdParams;
    query: never;
    body: never;
    response: PostApiBatchesIdResponse;
  };
  "postApiCron": {
    method: "POST";
    path: "/api/cron";
    params: never;
    query: never;
    body: never;
    response: PostApiCronResponse;
  };
  "postApiCspReport": {
    method: "POST";
    path: "/api/csp-report";
    params: never;
    query: never;
    body: never;
    response: PostApiCspReportResponse;
  };
  "postApiEscrows": {
    method: "POST";
    path: "/api/escrows";
    params: never;
    query: never;
    body: PostApiEscrowsBody;
    response: PostApiEscrowsResponse;
  };
  "postApiFeeConfig": {
    method: "POST";
    path: "/api/fee-config";
    params: never;
    query: never;
    body: PostApiFeeConfigBody;
    response: PostApiFeeConfigResponse;
  };
  "postApiGovernanceExecute": {
    method: "POST";
    path: "/api/governance/execute";
    params: never;
    query: never;
    body: PostApiGovernanceExecuteBody;
    response: PostApiGovernanceExecuteResponse;
  };
  "postApiGovernanceProposals": {
    method: "POST";
    path: "/api/governance/proposals";
    params: never;
    query: never;
    body: PostApiGovernanceProposalsBody;
    response: PostApiGovernanceProposalsResponse;
  };
  "postApiGovernanceVote": {
    method: "POST";
    path: "/api/governance/vote";
    params: never;
    query: never;
    body: PostApiGovernanceVoteBody;
    response: PostApiGovernanceVoteResponse;
  };
  "postApiHooks": {
    method: "POST";
    path: "/api/hooks";
    params: never;
    query: never;
    body: PostApiHooksBody;
    response: PostApiHooksResponse;
  };
  "postApiJobsProcessDueRecurring": {
    method: "POST";
    path: "/api/jobs/process-due-recurring";
    params: never;
    query: never;
    body: PostApiJobsProcessDueRecurringBody;
    response: PostApiJobsProcessDueRecurringResponse;
  };
  "postApiKeys": {
    method: "POST";
    path: "/api/keys";
    params: never;
    query: never;
    body: PostApiKeysBody;
    response: PostApiKeysResponse;
  };
  "postApiKeysIdRotate": {
    method: "POST";
    path: "/api/keys/{id}/rotate";
    params: PostApiKeysIdRotateParams;
    query: never;
    body: never;
    response: PostApiKeysIdRotateResponse;
  };
  "postApiMultisig": {
    method: "POST";
    path: "/api/multisig";
    params: never;
    query: never;
    body: PostApiMultisigBody;
    response: PostApiMultisigResponse;
  };
  "postApiMultisigApprove": {
    method: "POST";
    path: "/api/multisig/approve";
    params: never;
    query: never;
    body: PostApiMultisigApproveBody;
    response: PostApiMultisigApproveResponse;
  };
  "postApiMultisigExecute": {
    method: "POST";
    path: "/api/multisig/execute";
    params: never;
    query: never;
    body: PostApiMultisigExecuteBody;
    response: PostApiMultisigExecuteResponse;
  };
  "postApiMultisigPropose": {
    method: "POST";
    path: "/api/multisig/propose";
    params: never;
    query: never;
    body: PostApiMultisigProposeBody;
    response: PostApiMultisigProposeResponse;
  };
  "postApiPayments": {
    method: "POST";
    path: "/api/payments";
    params: never;
    query: never;
    body: PostApiPaymentsBody;
    response: PostApiPaymentsResponse;
  };
  "postApiPaymentsCancel": {
    method: "POST";
    path: "/api/payments/cancel";
    params: never;
    query: never;
    body: PostApiPaymentsCancelBody;
    response: PostApiPaymentsCancelResponse;
  };
  "postApiPaymentsRetry": {
    method: "POST";
    path: "/api/payments/retry";
    params: never;
    query: never;
    body: PostApiPaymentsRetryBody;
    response: PostApiPaymentsRetryResponse;
  };
  "postApiRbac": {
    method: "POST";
    path: "/api/rbac";
    params: never;
    query: never;
    body: PostApiRbacBody;
    response: PostApiRbacResponse;
  };
  "postApiRecurring": {
    method: "POST";
    path: "/api/recurring";
    params: never;
    query: never;
    body: PostApiRecurringBody;
    response: PostApiRecurringResponse;
  };
  "postApiRefunds": {
    method: "POST";
    path: "/api/refunds";
    params: never;
    query: never;
    body: PostApiRefundsBody;
    response: PostApiRefundsResponse;
  };
  "postApiRequests": {
    method: "POST";
    path: "/api/requests";
    params: never;
    query: never;
    body: PostApiRequestsBody;
    response: PostApiRequestsResponse;
  };
  "postApiRequestsIdPaid": {
    method: "POST";
    path: "/api/requests/{id}/paid";
    params: PostApiRequestsIdPaidParams;
    query: never;
    body: PostApiRequestsIdPaidBody;
    response: PostApiRequestsIdPaidResponse;
  };
  "postApiRequestsIdRemind": {
    method: "POST";
    path: "/api/requests/{id}/remind";
    params: PostApiRequestsIdRemindParams;
    query: never;
    body: never;
    response: PostApiRequestsIdRemindResponse;
  };
  "postApiScheduled": {
    method: "POST";
    path: "/api/scheduled";
    params: never;
    query: never;
    body: PostApiScheduledBody;
    response: PostApiScheduledResponse;
  };
  "postApiScheduledRun": {
    method: "POST";
    path: "/api/scheduled/run";
    params: never;
    query: never;
    body: never;
    response: PostApiScheduledRunResponse;
  };
  "postApiStreams": {
    method: "POST";
    path: "/api/streams";
    params: never;
    query: never;
    body: PostApiStreamsBody;
    response: PostApiStreamsResponse;
  };
  "postApiWebhooks": {
    method: "POST";
    path: "/api/webhooks";
    params: never;
    query: never;
    body: PostApiWebhooksBody;
    response: PostApiWebhooksResponse;
  };
  "postApiWebhooksIdDeliveriesDeliveryIdRedeliver": {
    method: "POST";
    path: "/api/webhooks/{id}/deliveries/{deliveryId}/redeliver";
    params: PostApiWebhooksIdDeliveriesDeliveryIdRedeliverParams;
    query: never;
    body: never;
    response: PostApiWebhooksIdDeliveriesDeliveryIdRedeliverResponse;
  };
  "postApiWebhooksIdReplay": {
    method: "POST";
    path: "/api/webhooks/{id}/replay";
    params: PostApiWebhooksIdReplayParams;
    query: never;
    body: PostApiWebhooksIdReplayBody;
    response: PostApiWebhooksIdReplayResponse;
  };
  "postApiWebhooksIdTest": {
    method: "POST";
    path: "/api/webhooks/{id}/test";
    params: PostApiWebhooksIdTestParams;
    query: never;
    body: never;
    response: PostApiWebhooksIdTestResponse;
  };
}

export interface OphirPayRoutes {
  "DELETE /api/auth/session": {
    operation: "deleteApiAuthSession";
    params: never;
    query: never;
    body: never;
    response: DeleteApiAuthSessionResponse;
  };
  "DELETE /api/keys": {
    operation: "deleteApiKeys";
    params: never;
    query: DeleteApiKeysQuery;
    body: never;
    response: DeleteApiKeysResponse;
  };
  "DELETE /api/payments/{id}": {
    operation: "deleteApiPaymentsId";
    params: DeleteApiPaymentsIdParams;
    query: never;
    body: never;
    response: DeleteApiPaymentsIdResponse;
  };
  "DELETE /api/scheduled": {
    operation: "deleteApiScheduled";
    params: never;
    query: DeleteApiScheduledQuery;
    body: never;
    response: DeleteApiScheduledResponse;
  };
  "DELETE /api/webhooks": {
    operation: "deleteApiWebhooks";
    params: never;
    query: DeleteApiWebhooksQuery;
    body: never;
    response: DeleteApiWebhooksResponse;
  };
  "GET /api/analytics": {
    operation: "getApiAnalytics";
    params: never;
    query: never;
    body: never;
    response: GetApiAnalyticsResponse;
  };
  "GET /api/assets/metadata": {
    operation: "getApiAssetsMetadata";
    params: never;
    query: GetApiAssetsMetadataQuery;
    body: never;
    response: GetApiAssetsMetadataResponse;
  };
  "GET /api/audit-log": {
    operation: "getApiAuditLog";
    params: never;
    query: GetApiAuditLogQuery;
    body: never;
    response: GetApiAuditLogResponse;
  };
  "GET /api/audit-log/export": {
    operation: "getApiAuditLogExport";
    params: never;
    query: GetApiAuditLogExportQuery;
    body: never;
    response: GetApiAuditLogExportResponse;
  };
  "GET /api/audit-log/sse": {
    operation: "getApiAuditLogSse";
    params: never;
    query: never;
    body: never;
    response: GetApiAuditLogSseResponse;
  };
  "GET /api/auth/challenge": {
    operation: "getApiAuthChallenge";
    params: never;
    query: GetApiAuthChallengeQuery;
    body: never;
    response: GetApiAuthChallengeResponse;
  };
  "GET /api/batches": {
    operation: "getApiBatches";
    params: never;
    query: GetApiBatchesQuery;
    body: never;
    response: GetApiBatchesResponse;
  };
  "GET /api/batches/{id}": {
    operation: "getApiBatchesId";
    params: GetApiBatchesIdParams;
    query: never;
    body: never;
    response: GetApiBatchesIdResponse;
  };
  "GET /api/batches/summary": {
    operation: "getApiBatchesSummary";
    params: never;
    query: GetApiBatchesSummaryQuery;
    body: never;
    response: GetApiBatchesSummaryResponse;
  };
  "GET /api/contracts": {
    operation: "getApiContracts";
    params: never;
    query: never;
    body: never;
    response: GetApiContractsResponse;
  };
  "GET /api/cron": {
    operation: "getApiCron";
    params: never;
    query: never;
    body: never;
    response: GetApiCronResponse;
  };
  "GET /api/csrf": {
    operation: "getApiCsrf";
    params: never;
    query: never;
    body: never;
    response: GetApiCsrfResponse;
  };
  "GET /api/escrows": {
    operation: "getApiEscrows";
    params: never;
    query: GetApiEscrowsQuery;
    body: never;
    response: GetApiEscrowsResponse;
  };
  "GET /api/escrows/{id}": {
    operation: "getApiEscrowsId";
    params: GetApiEscrowsIdParams;
    query: never;
    body: never;
    response: GetApiEscrowsIdResponse;
  };
  "GET /api/events": {
    operation: "getApiEvents";
    params: never;
    query: never;
    body: never;
    response: GetApiEventsResponse;
  };
  "GET /api/events/history": {
    operation: "getApiEventsHistory";
    params: never;
    query: GetApiEventsHistoryQuery;
    body: never;
    response: GetApiEventsHistoryResponse;
  };
  "GET /api/fee-config": {
    operation: "getApiFeeConfig";
    params: never;
    query: never;
    body: never;
    response: GetApiFeeConfigResponse;
  };
  "GET /api/fee-config/collector": {
    operation: "getApiFeeConfigCollector";
    params: never;
    query: never;
    body: never;
    response: GetApiFeeConfigCollectorResponse;
  };
  "GET /api/fee-config/history": {
    operation: "getApiFeeConfigHistory";
    params: never;
    query: never;
    body: never;
    response: GetApiFeeConfigHistoryResponse;
  };
  "GET /api/governance/proposals": {
    operation: "getApiGovernanceProposals";
    params: never;
    query: never;
    body: never;
    response: GetApiGovernanceProposalsResponse;
  };
  "GET /api/governance/proposals/{id}": {
    operation: "getApiGovernanceProposalsId";
    params: GetApiGovernanceProposalsIdParams;
    query: never;
    body: never;
    response: GetApiGovernanceProposalsIdResponse;
  };
  "GET /api/health": {
    operation: "getApiHealth";
    params: never;
    query: never;
    body: never;
    response: GetApiHealthResponse;
  };
  "GET /api/health/live": {
    operation: "getApiHealthLive";
    params: never;
    query: never;
    body: never;
    response: GetApiHealthLiveResponse;
  };
  "GET /api/hooks": {
    operation: "getApiHooks";
    params: never;
    query: GetApiHooksQuery;
    body: never;
    response: GetApiHooksResponse;
  };
  "GET /api/keys": {
    operation: "getApiKeys";
    params: never;
    query: never;
    body: never;
    response: GetApiKeysResponse;
  };
  "GET /api/keys/stats": {
    operation: "getApiKeysStats";
    params: never;
    query: GetApiKeysStatsQuery;
    body: never;
    response: GetApiKeysStatsResponse;
  };
  "GET /api/metrics": {
    operation: "getApiMetrics";
    params: never;
    query: never;
    body: never;
    response: GetApiMetricsResponse;
  };
  "GET /api/multisig": {
    operation: "getApiMultisig";
    params: never;
    query: never;
    body: never;
    response: GetApiMultisigResponse;
  };
  "GET /api/multisig/requests": {
    operation: "getApiMultisigRequests";
    params: never;
    query: never;
    body: never;
    response: GetApiMultisigRequestsResponse;
  };
  "GET /api/pause-state": {
    operation: "getApiPauseState";
    params: never;
    query: never;
    body: never;
    response: GetApiPauseStateResponse;
  };
  "GET /api/payments": {
    operation: "getApiPayments";
    params: never;
    query: GetApiPaymentsQuery;
    body: never;
    response: GetApiPaymentsResponse;
  };
  "GET /api/payments/export": {
    operation: "getApiPaymentsExport";
    params: never;
    query: GetApiPaymentsExportQuery;
    body: never;
    response: GetApiPaymentsExportResponse;
  };
  "GET /api/payments/{id}": {
    operation: "getApiPaymentsId";
    params: GetApiPaymentsIdParams;
    query: never;
    body: never;
    response: GetApiPaymentsIdResponse;
  };
  "GET /api/policy-versions": {
    operation: "getApiPolicyVersions";
    params: never;
    query: never;
    body: never;
    response: GetApiPolicyVersionsResponse;
  };
  "GET /api/rbac": {
    operation: "getApiRbac";
    params: never;
    query: GetApiRbacQuery;
    body: never;
    response: GetApiRbacResponse;
  };
  "GET /api/recurring": {
    operation: "getApiRecurring";
    params: never;
    query: GetApiRecurringQuery;
    body: never;
    response: GetApiRecurringResponse;
  };
  "GET /api/recurring/{id}": {
    operation: "getApiRecurringId";
    params: GetApiRecurringIdParams;
    query: never;
    body: never;
    response: GetApiRecurringIdResponse;
  };
  "GET /api/refunds": {
    operation: "getApiRefunds";
    params: never;
    query: GetApiRefundsQuery;
    body: never;
    response: GetApiRefundsResponse;
  };
  "GET /api/requests": {
    operation: "getApiRequests";
    params: never;
    query: never;
    body: never;
    response: GetApiRequestsResponse;
  };
  "GET /api/requests/expire": {
    operation: "getApiRequestsExpire";
    params: never;
    query: never;
    body: never;
    response: GetApiRequestsExpireResponse;
  };
  "GET /api/scheduled": {
    operation: "getApiScheduled";
    params: never;
    query: GetApiScheduledQuery;
    body: never;
    response: GetApiScheduledResponse;
  };
  "GET /api/scheduled/run": {
    operation: "getApiScheduledRun";
    params: never;
    query: never;
    body: never;
    response: GetApiScheduledRunResponse;
  };
  "GET /api/stats": {
    operation: "getApiStats";
    params: never;
    query: never;
    body: never;
    response: GetApiStatsResponse;
  };
  "GET /api/streams": {
    operation: "getApiStreams";
    params: never;
    query: GetApiStreamsQuery;
    body: never;
    response: GetApiStreamsResponse;
  };
  "GET /api/streams/{id}": {
    operation: "getApiStreamsId";
    params: GetApiStreamsIdParams;
    query: never;
    body: never;
    response: GetApiStreamsIdResponse;
  };
  "GET /api/timelock": {
    operation: "getApiTimelock";
    params: never;
    query: GetApiTimelockQuery;
    body: never;
    response: GetApiTimelockResponse;
  };
  "GET /api/webhooks": {
    operation: "getApiWebhooks";
    params: never;
    query: never;
    body: never;
    response: GetApiWebhooksResponse;
  };
  "GET /api/webhooks/{id}": {
    operation: "getApiWebhooksId";
    params: GetApiWebhooksIdParams;
    query: never;
    body: never;
    response: GetApiWebhooksIdResponse;
  };
  "GET /api/webhooks/{id}/deliveries": {
    operation: "getApiWebhooksIdDeliveries";
    params: GetApiWebhooksIdDeliveriesParams;
    query: GetApiWebhooksIdDeliveriesQuery;
    body: never;
    response: GetApiWebhooksIdDeliveriesResponse;
  };
  "GET /api/webhooks/{id}/deliveries/{deliveryId}": {
    operation: "getApiWebhooksIdDeliveriesDeliveryId";
    params: GetApiWebhooksIdDeliveriesDeliveryIdParams;
    query: never;
    body: never;
    response: GetApiWebhooksIdDeliveriesDeliveryIdResponse;
  };
  "GET /api/webhooks/{id}/test": {
    operation: "getApiWebhooksIdTest";
    params: GetApiWebhooksIdTestParams;
    query: GetApiWebhooksIdTestQuery;
    body: never;
    response: GetApiWebhooksIdTestResponse;
  };
  "PATCH /api/hooks/{id}": {
    operation: "patchApiHooksId";
    params: PatchApiHooksIdParams;
    query: never;
    body: PatchApiHooksIdBody;
    response: PatchApiHooksIdResponse;
  };
  "PATCH /api/keys": {
    operation: "patchApiKeys";
    params: never;
    query: never;
    body: PatchApiKeysBody;
    response: PatchApiKeysResponse;
  };
  "PATCH /api/payments/{id}": {
    operation: "patchApiPaymentsId";
    params: PatchApiPaymentsIdParams;
    query: never;
    body: PatchApiPaymentsIdBody;
    response: PatchApiPaymentsIdResponse;
  };
  "PATCH /api/recurring": {
    operation: "patchApiRecurring";
    params: never;
    query: never;
    body: PatchApiRecurringBody;
    response: PatchApiRecurringResponse;
  };
  "PATCH /api/recurring/{id}": {
    operation: "patchApiRecurringId";
    params: PatchApiRecurringIdParams;
    query: never;
    body: never;
    response: PatchApiRecurringIdResponse;
  };
  "PATCH /api/refunds/{id}": {
    operation: "patchApiRefundsId";
    params: PatchApiRefundsIdParams;
    query: never;
    body: PatchApiRefundsIdBody;
    response: PatchApiRefundsIdResponse;
  };
  "PATCH /api/webhooks": {
    operation: "patchApiWebhooks";
    params: never;
    query: PatchApiWebhooksQuery;
    body: never;
    response: PatchApiWebhooksResponse;
  };
  "POST /api/auth/session": {
    operation: "postApiAuthSession";
    params: never;
    query: never;
    body: PostApiAuthSessionBody;
    response: PostApiAuthSessionResponse;
  };
  "POST /api/batches": {
    operation: "postApiBatches";
    params: never;
    query: never;
    body: PostApiBatchesBody;
    response: PostApiBatchesResponse;
  };
  "POST /api/batches/{id}": {
    operation: "postApiBatchesId";
    params: PostApiBatchesIdParams;
    query: never;
    body: never;
    response: PostApiBatchesIdResponse;
  };
  "POST /api/cron": {
    operation: "postApiCron";
    params: never;
    query: never;
    body: never;
    response: PostApiCronResponse;
  };
  "POST /api/csp-report": {
    operation: "postApiCspReport";
    params: never;
    query: never;
    body: never;
    response: PostApiCspReportResponse;
  };
  "POST /api/escrows": {
    operation: "postApiEscrows";
    params: never;
    query: never;
    body: PostApiEscrowsBody;
    response: PostApiEscrowsResponse;
  };
  "POST /api/fee-config": {
    operation: "postApiFeeConfig";
    params: never;
    query: never;
    body: PostApiFeeConfigBody;
    response: PostApiFeeConfigResponse;
  };
  "POST /api/governance/execute": {
    operation: "postApiGovernanceExecute";
    params: never;
    query: never;
    body: PostApiGovernanceExecuteBody;
    response: PostApiGovernanceExecuteResponse;
  };
  "POST /api/governance/proposals": {
    operation: "postApiGovernanceProposals";
    params: never;
    query: never;
    body: PostApiGovernanceProposalsBody;
    response: PostApiGovernanceProposalsResponse;
  };
  "POST /api/governance/vote": {
    operation: "postApiGovernanceVote";
    params: never;
    query: never;
    body: PostApiGovernanceVoteBody;
    response: PostApiGovernanceVoteResponse;
  };
  "POST /api/hooks": {
    operation: "postApiHooks";
    params: never;
    query: never;
    body: PostApiHooksBody;
    response: PostApiHooksResponse;
  };
  "POST /api/jobs/process-due-recurring": {
    operation: "postApiJobsProcessDueRecurring";
    params: never;
    query: never;
    body: PostApiJobsProcessDueRecurringBody;
    response: PostApiJobsProcessDueRecurringResponse;
  };
  "POST /api/keys": {
    operation: "postApiKeys";
    params: never;
    query: never;
    body: PostApiKeysBody;
    response: PostApiKeysResponse;
  };
  "POST /api/keys/{id}/rotate": {
    operation: "postApiKeysIdRotate";
    params: PostApiKeysIdRotateParams;
    query: never;
    body: never;
    response: PostApiKeysIdRotateResponse;
  };
  "POST /api/multisig": {
    operation: "postApiMultisig";
    params: never;
    query: never;
    body: PostApiMultisigBody;
    response: PostApiMultisigResponse;
  };
  "POST /api/multisig/approve": {
    operation: "postApiMultisigApprove";
    params: never;
    query: never;
    body: PostApiMultisigApproveBody;
    response: PostApiMultisigApproveResponse;
  };
  "POST /api/multisig/execute": {
    operation: "postApiMultisigExecute";
    params: never;
    query: never;
    body: PostApiMultisigExecuteBody;
    response: PostApiMultisigExecuteResponse;
  };
  "POST /api/multisig/propose": {
    operation: "postApiMultisigPropose";
    params: never;
    query: never;
    body: PostApiMultisigProposeBody;
    response: PostApiMultisigProposeResponse;
  };
  "POST /api/payments": {
    operation: "postApiPayments";
    params: never;
    query: never;
    body: PostApiPaymentsBody;
    response: PostApiPaymentsResponse;
  };
  "POST /api/payments/cancel": {
    operation: "postApiPaymentsCancel";
    params: never;
    query: never;
    body: PostApiPaymentsCancelBody;
    response: PostApiPaymentsCancelResponse;
  };
  "POST /api/payments/retry": {
    operation: "postApiPaymentsRetry";
    params: never;
    query: never;
    body: PostApiPaymentsRetryBody;
    response: PostApiPaymentsRetryResponse;
  };
  "POST /api/rbac": {
    operation: "postApiRbac";
    params: never;
    query: never;
    body: PostApiRbacBody;
    response: PostApiRbacResponse;
  };
  "POST /api/recurring": {
    operation: "postApiRecurring";
    params: never;
    query: never;
    body: PostApiRecurringBody;
    response: PostApiRecurringResponse;
  };
  "POST /api/refunds": {
    operation: "postApiRefunds";
    params: never;
    query: never;
    body: PostApiRefundsBody;
    response: PostApiRefundsResponse;
  };
  "POST /api/requests": {
    operation: "postApiRequests";
    params: never;
    query: never;
    body: PostApiRequestsBody;
    response: PostApiRequestsResponse;
  };
  "POST /api/requests/{id}/paid": {
    operation: "postApiRequestsIdPaid";
    params: PostApiRequestsIdPaidParams;
    query: never;
    body: PostApiRequestsIdPaidBody;
    response: PostApiRequestsIdPaidResponse;
  };
  "POST /api/requests/{id}/remind": {
    operation: "postApiRequestsIdRemind";
    params: PostApiRequestsIdRemindParams;
    query: never;
    body: never;
    response: PostApiRequestsIdRemindResponse;
  };
  "POST /api/scheduled": {
    operation: "postApiScheduled";
    params: never;
    query: never;
    body: PostApiScheduledBody;
    response: PostApiScheduledResponse;
  };
  "POST /api/scheduled/run": {
    operation: "postApiScheduledRun";
    params: never;
    query: never;
    body: never;
    response: PostApiScheduledRunResponse;
  };
  "POST /api/streams": {
    operation: "postApiStreams";
    params: never;
    query: never;
    body: PostApiStreamsBody;
    response: PostApiStreamsResponse;
  };
  "POST /api/webhooks": {
    operation: "postApiWebhooks";
    params: never;
    query: never;
    body: PostApiWebhooksBody;
    response: PostApiWebhooksResponse;
  };
  "POST /api/webhooks/{id}/deliveries/{deliveryId}/redeliver": {
    operation: "postApiWebhooksIdDeliveriesDeliveryIdRedeliver";
    params: PostApiWebhooksIdDeliveriesDeliveryIdRedeliverParams;
    query: never;
    body: never;
    response: PostApiWebhooksIdDeliveriesDeliveryIdRedeliverResponse;
  };
  "POST /api/webhooks/{id}/replay": {
    operation: "postApiWebhooksIdReplay";
    params: PostApiWebhooksIdReplayParams;
    query: never;
    body: PostApiWebhooksIdReplayBody;
    response: PostApiWebhooksIdReplayResponse;
  };
  "POST /api/webhooks/{id}/test": {
    operation: "postApiWebhooksIdTest";
    params: PostApiWebhooksIdTestParams;
    query: never;
    body: never;
    response: PostApiWebhooksIdTestResponse;
  };
}
