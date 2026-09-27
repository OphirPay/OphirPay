// SPDX-License-Identifier: MIT
//
// ══════════════════════════════════════════════════════════════════════
//  Error taxonomy — the single source of truth (issue #760)
// ══════════════════════════════════════════════════════════════════════
//
//  Error handling used to be spread across five overlapping modules, so a
//  contributor adding a failure had to decide which of them owned the HTTP
//  status, the machine code and the user-visible copy — and reviewers could
//  not easily check that the three agreed.
//
//  This module now owns the taxonomy. Each error has:
//
//    • a machine `code`  (e.g. `PAYMENT_NOT_FOUND`)
//    • an HTTP `status`  (derived from the single `CODES_BY_STATUS` table)
//    • a default user-facing `message` (humanized, with per-code overrides)
//    • an optional interpolation `template`
//
//  Adding a new error means adding its name to exactly one status group in
//  `CODES_BY_STATUS` below — the status, `ERROR_STATUS` map, `ERROR_CODES`
//  catalog and taxonomy entry are all derived from that one edit.
//
//  Upstream parsers map into this taxonomy rather than returning raw strings:
//    • `stellar-error.ts`   → `classifyStellarError()`
//    • `contract-errors.ts` → `classifyContractError()` (in `error-messages.ts`)
//    • `prisma-errors.ts`   → `handlePrismaError()` returns taxonomy entries
//
//  `api-response.ts` is the only writer of the HTTP error envelope; it
//  serializes through `errorEnvelope()` here.

/**
 * THE taxonomy table. Codes are grouped by the HTTP status they map to, so
 * the status is data (the group key), not a second lookup table. Add a new
 * error by adding its name to exactly one group.
 */
const CODES_BY_STATUS = {
  400: [
    "BAD_REQUEST",
    "VALIDATION_ERROR",
    "MISSING_REQUIRED_FIELD",
    "INVALID_INPUT",
    "INVALID_PAGE",
    "INVALID_LIMIT",
    "INVALID_SORT",
    "INVALID_FILTER",
    "INVALID_CURSOR",
    "INVALID_FORMAT",
    "INVALID_AMOUNT",
    "AMOUNT_TOO_SMALL",
    "AMOUNT_TOO_LARGE",
    "AMOUNT_BELOW_MINIMUM",
    "AMOUNT_EXCEEDS_MAXIMUM",
    "INVALID_ADDRESS",
    "ADDRESS_MALFORMED",
    "MISSING_DESTINATION",
    "SELF_PAYMENT",
    "DESTINATION_INVALID",
    "INVALID_MEMO",
    "MEMO_REQUIRED",
    "MEMO_TOO_LONG",
    "MEMO_INVALID_FORMAT",
    "INVALID_ASSET",
    "ASSET_NOT_SUPPORTED",
    "INVALID_TRUSTLINE",
    "CSV_IMPORT_ERROR",
    "CSV_FORMAT_ERROR",
    "CSV_TOO_LARGE",
    "CSV_EMPTY",
    "CSV_MALFORMED_ROW",
    "EXPORT_FORMAT_INVALID",
    "EXPORT_TOO_LARGE",
    "DATE_RANGE_INVALID",
    "DATE_RANGE_TOO_LARGE",
    "INVALID_SIGNATURE",
    "INVALID_TIMESTAMP",
    "INVALID_CHALLENGE",
    "CHALLENGE_EXPIRED",
    "PAYMENT_CANCELLED",
    "PAYMENT_EXPIRED",
    "PAYMENT_PENDING",
    "PAYMENT_ALREADY_PROCESSED",
    "STREAM_PAUSED",
    "STREAM_RESUMED",
    "STREAM_CANCELLED",
    "STREAM_COMPLETED",
    "BATCH_PROCESSING",
    "BATCH_CANCELLED",
    "ESCROW_EXPIRED",
    "ESCROW_RESOLVED",
    "THRESHOLD_NOT_MET",
    "INVALID_THRESHOLD",
    "SIGNER_LIMIT_EXCEEDED",
    "SIGNER_WEIGHT_EXCEEDED",
    "SIGNER_WEIGHT_INVALID",
    "PROPOSAL_EXPIRED",
    "PROPOSAL_CANCELLED",
    "PROPOSAL_NOT_ACTIVE",
    "VOTING_ENDED",
    "VOTING_NOT_STARTED",
    "QUORUM_NOT_MET",
    "INSUFFICIENT_VOTING_POWER",
    "FOREIGN_KEY",
  ],
  401: [
    "UNAUTHORIZED",
    "INVALID_API_KEY",
    "API_KEY_MISSING",
    "API_KEY_DISABLED",
    "EXPIRED_API_KEY",
    "TOKEN_EXPIRED",
    "TOKEN_REVOKED",
    "TOKEN_MISSING",
    "TOKEN_INVALID",
    "SESSION_EXPIRED",
    "SESSION_INVALID",
    "INVALID_CREDENTIALS",
  ],
  402: ["INSUFFICIENT_FUNDS", "INSUFFICIENT_RESERVE"],
  403: [
    "FORBIDDEN",
    "INSUFFICIENT_PERMISSIONS",
    "INSUFFICIENT_SCOPE",
    "ROLE_REQUIRED",
    "NOT_OWNER",
    "NOT_SIGNER",
    "NOT_MEMBER",
    "NOT_APPROVER",
    "NOT_ADMIN",
    "ACCOUNT_DISABLED",
    "ACCOUNT_SUSPENDED",
    "RESOURCE_LOCKED",
    "WALLET_LOCKED",
    "REGION_RESTRICTED",
  ],
  404: [
    "NOT_FOUND",
    "PAYMENT_NOT_FOUND",
    "ESCROW_NOT_FOUND",
    "STREAM_NOT_FOUND",
    "BATCH_NOT_FOUND",
    "WEBHOOK_NOT_FOUND",
    "USER_NOT_FOUND",
    "ACCOUNT_NOT_FOUND",
    "WALLET_NOT_FOUND",
    "SIGNER_NOT_FOUND",
    "ASSET_NOT_FOUND",
    "API_KEY_NOT_FOUND",
    "KEY_NOT_FOUND",
    "TOKEN_NOT_FOUND",
    "CONTRACT_NOT_FOUND",
    "FUNCTION_NOT_FOUND",
    "FILE_NOT_FOUND",
    "EXPORT_NOT_FOUND",
    "NOTIFICATION_NOT_FOUND",
    "ROUTE_NOT_FOUND",
    "PROPOSAL_NOT_FOUND",
  ],
  405: ["METHOD_NOT_ALLOWED"],
  406: ["NOT_ACCEPTABLE"],
  408: ["REQUEST_TIMEOUT", "TRANSACTION_TIMEOUT", "CONTRACT_TIMEOUT", "RPC_TIMEOUT"],
  409: [
    "CONFLICT",
    "UNIQUE_CONSTRAINT",
    "DUPLICATE_REQUEST",
    "STATE_CONFLICT",
    "VERSION_CONFLICT",
    "SEQUENCE_NUMBER_MISMATCH",
    "OPERATION_IN_PROGRESS",
    "RESOURCE_IN_USE",
    "WALLET_ALREADY_CONNECTED",
    "STREAM_ALREADY_ACTIVE",
    "ESCROW_ALREADY_FUNDED",
    "ESCROW_ALREADY_COMPLETED",
    "USER_EXISTS",
    "EMAIL_EXISTS",
    "WALLET_EXISTS",
    "SIGNER_EXISTS",
    "WEBHOOK_EXISTS",
    "BATCH_CONFLICT",
    "ALREADY_APPROVED",
    "ALREADY_EXECUTED",
    "ALREADY_VOTED",
    "PROPOSAL_ALREADY_EXECUTED",
    "ESCROW_DISPUTED",
    "RELATION_VIOLATION",
  ],
  410: ["RESOURCE_DELETED", "CONTRACT_DEPRECATED"],
  413: [
    "PAYLOAD_TOO_LARGE",
    "BATCH_TOO_LARGE",
    "FILE_TOO_LARGE",
    "REQUEST_BODY_TOO_LARGE",
  ],
  415: ["UNSUPPORTED_MEDIA_TYPE", "UNSUPPORTED_ENCODING"],
  422: ["UNPROCESSABLE_ENTITY", "BUSINESS_RULE_VIOLATION"],
  429: [
    "RATE_LIMITED",
    "RATE_LIMIT_IP",
    "RATE_LIMIT_USER",
    "RATE_LIMIT_WALLET",
    "RATE_LIMIT_API_KEY",
    "RATE_LIMIT_GLOBAL",
    "RATE_LIMIT_BACKOFF",
  ],
  451: ["LEGALLY_RESTRICTED"],
  500: [
    "INTERNAL_ERROR",
    "DATABASE_ERROR",
    "DATABASE_QUERY_FAILED",
    "DATABASE_CONNECTION_FAILED",
    "DATABASE_TRANSACTION_FAILED",
    "DATABASE_DEADLOCK",
    "CONTRACT_ERROR",
    "CONTRACT_CALL_FAILED",
    "CONTRACT_DEPLOY_FAILED",
    "CONTRACT_COMPILE_FAILED",
    "CONTRACT_VERIFY_FAILED",
    "RPC_ERROR",
    "RPC_NODE_ERROR",
    "NETWORK_ERROR",
    "NETWORK_TIMEOUT",
    "STELLAR_ERROR",
    "HORIZON_ERROR",
    "SOROBAN_ERROR",
    "EMAIL_SEND_FAILED",
    "NOTIFICATION_FAILED",
    "WEBHOOK_DELIVERY_FAILED",
    "WEBHOOK_SIGNATURE_INVALID",
    "FILE_UPLOAD_FAILED",
    "FILE_PROCESSING_FAILED",
    "EXPORT_FAILED",
    "IMPORT_FAILED",
    "SEARCH_INDEX_ERROR",
    "SEARCH_FAILED",
    "CACHE_ERROR",
    "CACHE_MISS",
    "CONFIG_ERROR",
    "FEATURE_NOT_ENABLED",
    "MAINTENANCE_MODE",
    "UNKNOWN_ERROR",
    "PAYMENT_FAILED",
    "TRANSACTION_FAILED",
    "TRANSACTION_EXPIRED",
    "TRANSACTION_REJECTED",
    "BATCH_PARTIAL_SUCCESS",
    "BATCH_FAILED",
    "MULTISIG_NOT_CONFIGURED",
    "WALLET_NOT_INSTALLED",
    "WALLET_CONNECTION_FAILED",
    "WALLET_DISCONNECTED",
    "WALLET_NETWORK_MISMATCH",
    "WALLET_SIGN_FAILED",
    "WALLET_SIGN_REJECTED",
    "WALLET_NOT_SUPPORTED",
  ],
  503: [
    "CONTRACT_UNAVAILABLE",
    "SERVICE_UNAVAILABLE",
    "OVERLOADED",
    "DEPENDENCY_UNAVAILABLE",
    "STELLAR_UNAVAILABLE",
    "HORIZON_UNAVAILABLE",
    "SOROBAN_UNAVAILABLE",
    "RPC_UNAVAILABLE",
    "DATABASE_UNAVAILABLE",
    "CACHE_UNAVAILABLE",
    "EMAIL_UNAVAILABLE",
    "DB_CONNECTION",
  ],
} as const;

/** Union of every valid error code. */
export type ErrorCode =
  (typeof CODES_BY_STATUS)[keyof typeof CODES_BY_STATUS][number];

const ALL_CODES = (
  Object.values(CODES_BY_STATUS) as readonly (readonly string[])[]
).flat() as readonly ErrorCode[];

/**
 * Machine code catalog: `ERROR_CODES.PAYMENT_NOT_FOUND === "PAYMENT_NOT_FOUND"`.
 * Derived from the taxonomy, so the two can never disagree.
 */
export const ERROR_CODES = (() => {
  const out: Record<string, string> = {};
  for (const code of ALL_CODES) out[code] = code;
  return out as { readonly [K in ErrorCode]: K };
})();

/** HTTP status for each code, derived from the taxonomy groups. */
export const ERROR_STATUS: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const [status, codes] of Object.entries(CODES_BY_STATUS)) {
    for (const code of codes as readonly string[]) out[code] = Number(status);
  }
  return out;
})();

/** A single taxonomy entry. */
export interface ErrorDefinition {
  code: ErrorCode;
  status: number;
  message: string;
  /** Optional interpolation template (e.g. `"{field} already exists."`). */
  template?: string;
}

/**
 * Per-code user-facing copy. Codes without an override get a humanized
 * default (`PAYMENT_NOT_FOUND` → "Payment not found.").
 */
const MESSAGE_OVERRIDES: Partial<
  Record<ErrorCode, { message: string; template?: string }>
> = {
  BAD_REQUEST: { message: "The request is invalid." },
  VALIDATION_ERROR: { message: "Request validation failed." },
  MISSING_REQUIRED_FIELD: { message: "A required field is missing.", template: "{field} is required." },
  INVALID_INPUT: { message: "The supplied input is invalid." },
  UNAUTHORIZED: { message: "Authentication is required." },
  INVALID_CREDENTIALS: { message: "The supplied credentials are invalid." },
  FORBIDDEN: { message: "You do not have permission to perform this action." },
  INSUFFICIENT_PERMISSIONS: { message: "You do not have the required permissions." },
  NOT_FOUND: { message: "The requested resource was not found." },
  PAYMENT_NOT_FOUND: { message: "The payment was not found." },
  CONFLICT: { message: "The request conflicts with the current state." },
  UNIQUE_CONSTRAINT: { message: "A record with this value already exists.", template: "A record with this {field} already exists." },
  RATE_LIMITED: { message: "Too many requests. Please try again later." },
  RATE_LIMIT_IP: { message: "Too many requests from this IP. Please try again later." },
  RATE_LIMIT_USER: { message: "Too many requests for this account. Please try again later." },
  RATE_LIMIT_WALLET: { message: "Too many requests for this wallet. Please try again later." },
  RATE_LIMIT_API_KEY: { message: "Too many requests for this API key. Please try again later." },
  RATE_LIMIT_GLOBAL: { message: "The service is rate limited. Please try again later." },
  RATE_LIMIT_BACKOFF: { message: "Temporarily rate limited. Please back off and retry." },
  INTERNAL_ERROR: { message: "An unexpected server error occurred." },
  SERVICE_UNAVAILABLE: { message: "The service is temporarily unavailable." },
  DATABASE_ERROR: { message: "A database error occurred." },
  DB_CONNECTION: { message: "Could not connect to the database." },
  CSV_EMPTY: { message: "The CSV file is empty." },
  CSV_FORMAT_ERROR: { message: "The CSV format is invalid." },
  CSV_MALFORMED_ROW: { message: "A row in the CSV is malformed." },
  CSV_TOO_LARGE: { message: "The CSV file is too large." },
  STELLAR_ERROR: { message: "A Stellar network error occurred." },
  HORIZON_ERROR: { message: "A Horizon request failed." },
  SOROBAN_ERROR: { message: "A Soroban contract call failed." },
  CONTRACT_ERROR: { message: "Smart contract execution failed." },
  INVALID_ADDRESS: { message: "Please enter a valid Stellar address." },
  INVALID_AMOUNT: { message: "Please enter a valid positive amount." },
  SELF_PAYMENT: { message: "Cannot send to your own address." },
  MEMO_TOO_LONG: { message: "Memo must be 28 characters or fewer." },
  INSUFFICIENT_FUNDS: { message: "Insufficient funds to complete this operation." },
  INSUFFICIENT_RESERVE: { message: "The account would fall below the minimum reserve." },
} as Partial<Record<ErrorCode, { message: string; template?: string }>>;

function humanize(code: string): string {
  const words = code.toLowerCase().split("_");
  const first = words[0] ?? code.toLowerCase();
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return `${words.join(" ")}.`;
}

/**
 * The full taxonomy: every code mapped to its status, default message and
 * optional template. Derived from `CODES_BY_STATUS` + `MESSAGE_OVERRIDES`.
 */
export const ERROR_TAXONOMY: Record<ErrorCode, ErrorDefinition> = (() => {
  const out = {} as Record<ErrorCode, ErrorDefinition>;
  for (const code of ALL_CODES) {
    const override = MESSAGE_OVERRIDES[code];
    out[code] = {
      code,
      status: ERROR_STATUS[code]!,
      message: override?.message ?? humanize(code),
      template: override?.template,
    };
  }
  return out;
})();

/** Look up a taxonomy entry, falling back to INTERNAL_ERROR for unknown codes. */
export function getErrorDefinition(code: ErrorCode | string): ErrorDefinition {
  return ERROR_TAXONOMY[code as ErrorCode] ?? ERROR_TAXONOMY.INTERNAL_ERROR;
}

/** HTTP status for a code (derived from the taxonomy). */
export function errorStatus(code: ErrorCode | string): number {
  return getErrorDefinition(code).status;
}

/** Default user-facing message for a code. */
export function errorMessage(code: ErrorCode | string): string {
  return getErrorDefinition(code).message;
}

/** The JSON error envelope shape written by the single serializer. */
export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

/**
 * Build the canonical error envelope. This is the *only* place the
 * `{ success: false, error: { code, message, details }, timestamp }` shape is
 * constructed; every response writer serializes through it.
 */
export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    success: false,
    error: { code, message, details: details === undefined ? undefined : details },
    timestamp: new Date().toISOString(),
  };
}
