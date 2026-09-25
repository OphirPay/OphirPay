// SPDX-License-Identifier: MIT

/**
 * Single Unified Error Taxonomy (Issue #760)
 *
 * Defines machine error codes, HTTP status, default user-facing messages,
 * message templates with interpolation, and error categories.
 *
 * All upstream modules (contract-errors, stellar-error, prisma-errors)
 * map into this taxonomy, and api-response.ts is the sole serializer.
 */

export interface ErrorTaxonomyEntry {
  /** Machine-readable error code */
  code: string;
  /** HTTP status code */
  status: number;
  /** User-facing message */
  message: string;
  /** Optional parameterized template */
  template?: string;
  /** Optional category */
  category?: string;
}

export const ERROR_TAXONOMY = {
  BAD_REQUEST: { code: "BAD_REQUEST", status: 400, message: "The request could not be processed due to invalid parameters.", category: "client" },
  VALIDATION_ERROR: { code: "VALIDATION_ERROR", status: 400, message: "Request validation failed. Please check the provided fields.", category: "client" },
  MISSING_REQUIRED_FIELD: { code: "MISSING_REQUIRED_FIELD", status: 400, message: "One or more required fields are missing.", template: "Missing required field: {field}", category: "client" },
  INVALID_INPUT: { code: "INVALID_INPUT", status: 400, message: "Invalid input provided.", category: "client" },
  INVALID_PAGE: { code: "INVALID_PAGE", status: 400, message: "Page number must be a positive integer.", category: "client" },
  INVALID_LIMIT: { code: "INVALID_LIMIT", status: 400, message: "Limit must be between 1 and 100.", category: "client" },
  INVALID_SORT: { code: "INVALID_SORT", status: 400, message: "Invalid sort field or direction.", category: "client" },
  INVALID_FILTER: { code: "INVALID_FILTER", status: 400, message: "Invalid filter parameter provided.", category: "client" },
  INVALID_CURSOR: { code: "INVALID_CURSOR", status: 400, message: "Invalid pagination cursor provided.", category: "client" },
  INVALID_FORMAT: { code: "INVALID_FORMAT", status: 400, message: "Invalid data format.", category: "client" },
  INVALID_AMOUNT: { code: "INVALID_AMOUNT", status: 400, message: "Please enter a valid positive amount.", category: "client" },
  AMOUNT_TOO_SMALL: { code: "AMOUNT_TOO_SMALL", status: 400, message: "Amount is below the minimum allowed.", template: "Amount must be at least {min}.", category: "client" },
  AMOUNT_TOO_LARGE: { code: "AMOUNT_TOO_LARGE", status: 400, message: "Amount exceeds the maximum allowed.", template: "Amount cannot exceed {max}.", category: "client" },
  AMOUNT_BELOW_MINIMUM: { code: "AMOUNT_BELOW_MINIMUM", status: 400, message: "Amount is below the minimum threshold.", category: "client" },
  AMOUNT_EXCEEDS_MAXIMUM: { code: "AMOUNT_EXCEEDS_MAXIMUM", status: 400, message: "Amount exceeds the maximum limit.", category: "client" },
  INVALID_ADDRESS: { code: "INVALID_ADDRESS", status: 400, message: "Please enter a valid Stellar address (starts with G, 56 characters).", category: "client" },
  ADDRESS_MALFORMED: { code: "ADDRESS_MALFORMED", status: 400, message: "Malformed Stellar public key address.", category: "client" },
  MISSING_DESTINATION: { code: "MISSING_DESTINATION", status: 400, message: "Destination address is required.", category: "client" },
  SELF_PAYMENT: { code: "SELF_PAYMENT", status: 400, message: "Cannot send payment to your own address.", category: "client" },
  DESTINATION_INVALID: { code: "DESTINATION_INVALID", status: 400, message: "Destination account does not exist or is invalid.", category: "client" },
  INVALID_MEMO: { code: "INVALID_MEMO", status: 400, message: "Invalid transaction memo format.", category: "client" },
  MEMO_REQUIRED: { code: "MEMO_REQUIRED", status: 400, message: "A destination memo is required for this account.", category: "client" },
  MEMO_TOO_LONG: { code: "MEMO_TOO_LONG", status: 400, message: "Memo must be 28 characters or fewer.", category: "client" },
  MEMO_INVALID_FORMAT: { code: "MEMO_INVALID_FORMAT", status: 400, message: "Memo format is not supported.", category: "client" },
  INVALID_ASSET: { code: "INVALID_ASSET", status: 400, message: "Invalid or unsupported Stellar asset.", category: "client" },
  ASSET_NOT_SUPPORTED: { code: "ASSET_NOT_SUPPORTED", status: 400, message: "This asset is not supported by the payment contract.", category: "client" },
  INVALID_TRUSTLINE: { code: "INVALID_TRUSTLINE", status: 400, message: "Trustline not established for this asset. Establish a trustline first.", category: "client" },
  CSV_IMPORT_ERROR: { code: "CSV_IMPORT_ERROR", status: 400, message: "Failed to parse CSV file.", category: "client" },
  CSV_FORMAT_ERROR: { code: "CSV_FORMAT_ERROR", status: 400, message: "CSV file has invalid headers or structure.", category: "client" },
  CSV_TOO_LARGE: { code: "CSV_TOO_LARGE", status: 400, message: "CSV file exceeds maximum upload size.", category: "client" },
  CSV_EMPTY: { code: "CSV_EMPTY", status: 400, message: "Uploaded CSV file contains no data rows.", category: "client" },
  CSV_MALFORMED_ROW: { code: "CSV_MALFORMED_ROW", status: 400, message: "One or more CSV rows are malformed.", category: "client" },
  EXPORT_FORMAT_INVALID: { code: "EXPORT_FORMAT_INVALID", status: 400, message: "Requested export format is not supported.", category: "client" },
  EXPORT_TOO_LARGE: { code: "EXPORT_TOO_LARGE", status: 400, message: "Export dataset exceeds maximum row limit.", category: "client" },
  DATE_RANGE_INVALID: { code: "DATE_RANGE_INVALID", status: 400, message: "Invalid date range provided. Start date must be before end date.", category: "client" },
  DATE_RANGE_TOO_LARGE: { code: "DATE_RANGE_TOO_LARGE", status: 400, message: "Requested date range exceeds the maximum allowed window.", category: "client" },
  INVALID_SIGNATURE: { code: "INVALID_SIGNATURE", status: 400, message: "Cryptographic signature verification failed.", category: "client" },
  INVALID_TIMESTAMP: { code: "INVALID_TIMESTAMP", status: 400, message: "Timestamp is invalid or outside the acceptable drift window.", category: "client" },
  INVALID_CHALLENGE: { code: "INVALID_CHALLENGE", status: 400, message: "Challenge transaction is invalid or already consumed.", category: "client" },
  CHALLENGE_EXPIRED: { code: "CHALLENGE_EXPIRED", status: 400, message: "Authentication challenge has expired. Request a new challenge.", category: "client" },
  PAYMENT_CANCELLED: { code: "PAYMENT_CANCELLED", status: 400, message: "Payment was cancelled.", category: "client" },
  PAYMENT_EXPIRED: { code: "PAYMENT_EXPIRED", status: 400, message: "Payment request has expired.", category: "client" },
  PAYMENT_PENDING: { code: "PAYMENT_PENDING", status: 400, message: "Payment is pending authorization.", category: "client" },
  PAYMENT_ALREADY_PROCESSED: { code: "PAYMENT_ALREADY_PROCESSED", status: 400, message: "This payment has already been processed.", category: "client" },
  STREAM_PAUSED: { code: "STREAM_PAUSED", status: 400, message: "Payment stream is paused.", category: "client" },
  STREAM_RESUMED: { code: "STREAM_RESUMED", status: 400, message: "Payment stream is already resumed.", category: "client" },
  STREAM_CANCELLED: { code: "STREAM_CANCELLED", status: 400, message: "Payment stream was cancelled.", category: "client" },
  STREAM_COMPLETED: { code: "STREAM_COMPLETED", status: 400, message: "Payment stream has completed.", category: "client" },
  BATCH_PROCESSING: { code: "BATCH_PROCESSING", status: 400, message: "Batch payment is currently processing.", category: "client" },
  BATCH_CANCELLED: { code: "BATCH_CANCELLED", status: 400, message: "Batch payment was cancelled.", category: "client" },
  ESCROW_EXPIRED: { code: "ESCROW_EXPIRED", status: 400, message: "Escrow release window has expired.", category: "client" },
  ESCROW_RESOLVED: { code: "ESCROW_RESOLVED", status: 400, message: "Escrow has already been resolved.", category: "client" },
  THRESHOLD_NOT_MET: { code: "THRESHOLD_NOT_MET", status: 400, message: "Required signature threshold was not met.", category: "client" },
  INVALID_THRESHOLD: { code: "INVALID_THRESHOLD", status: 400, message: "Threshold value must be between 1 and the total weight of signers.", category: "client" },
  SIGNER_LIMIT_EXCEEDED: { code: "SIGNER_LIMIT_EXCEEDED", status: 400, message: "Maximum number of multisig signers exceeded.", category: "client" },
  SIGNER_WEIGHT_EXCEEDED: { code: "SIGNER_WEIGHT_EXCEEDED", status: 400, message: "Signer weight exceeds the maximum allowed value.", category: "client" },
  SIGNER_WEIGHT_INVALID: { code: "SIGNER_WEIGHT_INVALID", status: 400, message: "Signer weight must be a positive integer.", category: "client" },
  PROPOSAL_EXPIRED: { code: "PROPOSAL_EXPIRED", status: 400, message: "Governance proposal has expired.", category: "client" },
  PROPOSAL_CANCELLED: { code: "PROPOSAL_CANCELLED", status: 400, message: "Governance proposal was cancelled.", category: "client" },
  PROPOSAL_NOT_ACTIVE: { code: "PROPOSAL_NOT_ACTIVE", status: 400, message: "Governance proposal is not currently active for voting.", category: "client" },
  VOTING_ENDED: { code: "VOTING_ENDED", status: 400, message: "Voting period has ended for this proposal.", category: "client" },
  VOTING_NOT_STARTED: { code: "VOTING_NOT_STARTED", status: 400, message: "Voting has not started yet for this proposal.", category: "client" },
  QUORUM_NOT_MET: { code: "QUORUM_NOT_MET", status: 400, message: "Quorum threshold was not met for this proposal.", category: "client" },
  INSUFFICIENT_VOTING_POWER: { code: "INSUFFICIENT_VOTING_POWER", status: 400, message: "Insufficient voting power to cast this vote.", category: "client" },
  UNAUTHORIZED: { code: "UNAUTHORIZED", status: 401, message: "Authentication required. Please log in or provide an API key.", category: "auth" },
  INVALID_API_KEY: { code: "INVALID_API_KEY", status: 401, message: "The provided API key is invalid.", category: "auth" },
  API_KEY_MISSING: { code: "API_KEY_MISSING", status: 401, message: "API key is required in headers (x-api-key or Authorization Bearer).", category: "auth" },
  API_KEY_DISABLED: { code: "API_KEY_DISABLED", status: 401, message: "This API key has been disabled.", category: "auth" },
  EXPIRED_API_KEY: { code: "EXPIRED_API_KEY", status: 401, message: "This API key has expired.", category: "auth" },
  TOKEN_EXPIRED: { code: "TOKEN_EXPIRED", status: 401, message: "Authentication token has expired. Please refresh your session.", category: "auth" },
  TOKEN_REVOKED: { code: "TOKEN_REVOKED", status: 401, message: "Authentication token has been revoked.", category: "auth" },
  TOKEN_MISSING: { code: "TOKEN_MISSING", status: 401, message: "Bearer authentication token is missing.", category: "auth" },
  TOKEN_INVALID: { code: "TOKEN_INVALID", status: 401, message: "Authentication token is invalid or malformed.", category: "auth" },
  SESSION_EXPIRED: { code: "SESSION_EXPIRED", status: 401, message: "Your session has expired. Please sign in again.", category: "auth" },
  SESSION_INVALID: { code: "SESSION_INVALID", status: 401, message: "Session is invalid.", category: "auth" },
  INVALID_CREDENTIALS: { code: "INVALID_CREDENTIALS", status: 401, message: "Invalid username or password.", category: "auth" },
  INSUFFICIENT_FUNDS: { code: "INSUFFICIENT_FUNDS", status: 402, message: "Insufficient funds to complete this transaction.", template: "Insufficient balance. You have {balance}, but need {needed}.", category: "payment" },
  INSUFFICIENT_RESERVE: { code: "INSUFFICIENT_RESERVE", status: 402, message: "Account would fall below the minimum Stellar reserve. Keep at least 1 XLM.", category: "payment" },
  FORBIDDEN: { code: "FORBIDDEN", status: 403, message: "You do not have permission to perform this action.", category: "forbidden" },
  INSUFFICIENT_PERMISSIONS: { code: "INSUFFICIENT_PERMISSIONS", status: 403, message: "Insufficient permissions for this operation.", category: "forbidden" },
  INSUFFICIENT_SCOPE: { code: "INSUFFICIENT_SCOPE", status: 403, message: "API key or token lacks the required scope for this endpoint.", category: "forbidden" },
  ROLE_REQUIRED: { code: "ROLE_REQUIRED", status: 403, message: "A specific role is required to access this resource.", category: "forbidden" },
  NOT_OWNER: { code: "NOT_OWNER", status: 403, message: "Only the owner can perform this operation.", category: "forbidden" },
  NOT_SIGNER: { code: "NOT_SIGNER", status: 403, message: "Caller is not an authorized multisig signer.", category: "forbidden" },
  NOT_MEMBER: { code: "NOT_MEMBER", status: 403, message: "Caller is not a member of this organization or account.", category: "forbidden" },
  NOT_APPROVER: { code: "NOT_APPROVER", status: 403, message: "Caller is not designated as an approver.", category: "forbidden" },
  NOT_ADMIN: { code: "NOT_ADMIN", status: 403, message: "Administrator privileges required.", category: "forbidden" },
  ACCOUNT_DISABLED: { code: "ACCOUNT_DISABLED", status: 403, message: "This account has been disabled.", category: "forbidden" },
  ACCOUNT_SUSPENDED: { code: "ACCOUNT_SUSPENDED", status: 403, message: "This account is suspended.", category: "forbidden" },
  RESOURCE_LOCKED: { code: "RESOURCE_LOCKED", status: 403, message: "This resource is locked and cannot be modified.", category: "forbidden" },
  WALLET_LOCKED: { code: "WALLET_LOCKED", status: 403, message: "Wallet is locked. Unlock in wallet extension.", category: "forbidden" },
  REGION_RESTRICTED: { code: "REGION_RESTRICTED", status: 403, message: "This service is not available in your region.", category: "forbidden" },
  NOT_FOUND: { code: "NOT_FOUND", status: 404, message: "The requested resource was not found.", category: "not_found" },
  PAYMENT_NOT_FOUND: { code: "PAYMENT_NOT_FOUND", status: 404, message: "Payment record was not found.", category: "not_found" },
  ESCROW_NOT_FOUND: { code: "ESCROW_NOT_FOUND", status: 404, message: "Escrow contract or record not found.", category: "not_found" },
  STREAM_NOT_FOUND: { code: "STREAM_NOT_FOUND", status: 404, message: "Payment stream was not found.", category: "not_found" },
  BATCH_NOT_FOUND: { code: "BATCH_NOT_FOUND", status: 404, message: "Batch payment was not found.", category: "not_found" },
  WEBHOOK_NOT_FOUND: { code: "WEBHOOK_NOT_FOUND", status: 404, message: "Webhook subscription was not found.", category: "not_found" },
  USER_NOT_FOUND: { code: "USER_NOT_FOUND", status: 404, message: "User account was not found.", category: "not_found" },
  ACCOUNT_NOT_FOUND: { code: "ACCOUNT_NOT_FOUND", status: 404, message: "Stellar account was not found on the network.", category: "not_found" },
  WALLET_NOT_FOUND: { code: "WALLET_NOT_FOUND", status: 404, message: "Wallet address was not found.", category: "not_found" },
  SIGNER_NOT_FOUND: { code: "SIGNER_NOT_FOUND", status: 404, message: "Signer not found in the signer list.", category: "not_found" },
  ASSET_NOT_FOUND: { code: "ASSET_NOT_FOUND", status: 404, message: "Asset not found or issuer does not exist.", category: "not_found" },
  API_KEY_NOT_FOUND: { code: "API_KEY_NOT_FOUND", status: 404, message: "API key was not found.", category: "not_found" },
  KEY_NOT_FOUND: { code: "KEY_NOT_FOUND", status: 404, message: "Specified key not found.", category: "not_found" },
  TOKEN_NOT_FOUND: { code: "TOKEN_NOT_FOUND", status: 404, message: "Token contract was not found.", category: "not_found" },
  CONTRACT_NOT_FOUND: { code: "CONTRACT_NOT_FOUND", status: 404, message: "Smart contract was not found at specified address.", category: "not_found" },
  FUNCTION_NOT_FOUND: { code: "FUNCTION_NOT_FOUND", status: 404, message: "Contract function not found.", category: "not_found" },
  FILE_NOT_FOUND: { code: "FILE_NOT_FOUND", status: 404, message: "Requested file was not found.", category: "not_found" },
  EXPORT_NOT_FOUND: { code: "EXPORT_NOT_FOUND", status: 404, message: "Export task or file not found.", category: "not_found" },
  NOTIFICATION_NOT_FOUND: { code: "NOTIFICATION_NOT_FOUND", status: 404, message: "Notification was not found.", category: "not_found" },
  ROUTE_NOT_FOUND: { code: "ROUTE_NOT_FOUND", status: 404, message: "API route was not found.", category: "not_found" },
  PROPOSAL_NOT_FOUND: { code: "PROPOSAL_NOT_FOUND", status: 404, message: "Governance proposal was not found.", category: "not_found" },
  METHOD_NOT_ALLOWED: { code: "METHOD_NOT_ALLOWED", status: 405, message: "HTTP method not allowed on this endpoint.", category: "client" },
  NOT_ACCEPTABLE: { code: "NOT_ACCEPTABLE", status: 406, message: "Accept header not supported.", category: "client" },
  REQUEST_TIMEOUT: { code: "REQUEST_TIMEOUT", status: 408, message: "Request timed out waiting for response.", category: "timeout" },
  TRANSACTION_TIMEOUT: { code: "TRANSACTION_TIMEOUT", status: 408, message: "Stellar transaction submission timed out.", category: "timeout" },
  CONTRACT_TIMEOUT: { code: "CONTRACT_TIMEOUT", status: 408, message: "Contract execution simulation timed out.", category: "timeout" },
  RPC_TIMEOUT: { code: "RPC_TIMEOUT", status: 408, message: "RPC endpoint timed out.", category: "timeout" },
  CONFLICT: { code: "CONFLICT", status: 409, message: "Resource conflict occurred.", category: "conflict" },
  UNIQUE_CONSTRAINT: { code: "UNIQUE_CONSTRAINT", status: 409, message: "A record with these unique attributes already exists.", template: "A record with this {field} already exists.", category: "conflict" },
  DUPLICATE_REQUEST: { code: "DUPLICATE_REQUEST", status: 409, message: "Duplicate request detected with same idempotency key.", category: "conflict" },
  STATE_CONFLICT: { code: "STATE_CONFLICT", status: 409, message: "Operation conflicts with current resource state.", category: "conflict" },
  VERSION_CONFLICT: { code: "VERSION_CONFLICT", status: 409, message: "Resource version mismatch. Refresh and retry.", category: "conflict" },
  SEQUENCE_NUMBER_MISMATCH: { code: "SEQUENCE_NUMBER_MISMATCH", status: 409, message: "Transaction sequence number mismatch. Refresh account state and retry.", category: "conflict" },
  OPERATION_IN_PROGRESS: { code: "OPERATION_IN_PROGRESS", status: 409, message: "An operation is already in progress on this resource.", category: "conflict" },
  RESOURCE_IN_USE: { code: "RESOURCE_IN_USE", status: 409, message: "Resource is currently in use and cannot be modified.", category: "conflict" },
  WALLET_ALREADY_CONNECTED: { code: "WALLET_ALREADY_CONNECTED", status: 409, message: "Wallet is already connected to another session.", category: "conflict" },
  STREAM_ALREADY_ACTIVE: { code: "STREAM_ALREADY_ACTIVE", status: 409, message: "Payment stream is already active.", category: "conflict" },
  ESCROW_ALREADY_FUNDED: { code: "ESCROW_ALREADY_FUNDED", status: 409, message: "Escrow is already funded.", category: "conflict" },
  ESCROW_ALREADY_COMPLETED: { code: "ESCROW_ALREADY_COMPLETED", status: 409, message: "Escrow has already been completed.", category: "conflict" },
  USER_EXISTS: { code: "USER_EXISTS", status: 409, message: "A user with this identifier already exists.", category: "conflict" },
  EMAIL_EXISTS: { code: "EMAIL_EXISTS", status: 409, message: "A user with this email address already exists.", category: "conflict" },
  WALLET_EXISTS: { code: "WALLET_EXISTS", status: 409, message: "Wallet address is already registered.", category: "conflict" },
  SIGNER_EXISTS: { code: "SIGNER_EXISTS", status: 409, message: "Signer is already added to multisig config.", category: "conflict" },
  WEBHOOK_EXISTS: { code: "WEBHOOK_EXISTS", status: 409, message: "Webhook subscription already exists for this URL and event.", category: "conflict" },
  BATCH_CONFLICT: { code: "BATCH_CONFLICT", status: 409, message: "Batch status conflict.", category: "conflict" },
  ALREADY_APPROVED: { code: "ALREADY_APPROVED", status: 409, message: "Action has already been approved by this signer.", category: "conflict" },
  ALREADY_EXECUTED: { code: "ALREADY_EXECUTED", status: 409, message: "Action or transaction has already been executed.", category: "conflict" },
  ALREADY_VOTED: { code: "ALREADY_VOTED", status: 409, message: "Account has already cast a vote on this proposal.", category: "conflict" },
  PROPOSAL_ALREADY_EXECUTED: { code: "PROPOSAL_ALREADY_EXECUTED", status: 409, message: "Proposal has already been executed.", category: "conflict" },
  ESCROW_DISPUTED: { code: "ESCROW_DISPUTED", status: 409, message: "Escrow is in a disputed state.", category: "conflict" },
  RESOURCE_DELETED: { code: "RESOURCE_DELETED", status: 410, message: "Requested resource has been permanently deleted.", category: "gone" },
  CONTRACT_DEPRECATED: { code: "CONTRACT_DEPRECATED", status: 410, message: "This contract version is deprecated.", category: "gone" },
  PAYLOAD_TOO_LARGE: { code: "PAYLOAD_TOO_LARGE", status: 413, message: "Request payload exceeds allowed maximum.", category: "payload" },
  BATCH_TOO_LARGE: { code: "BATCH_TOO_LARGE", status: 413, message: "A batch can contain at most 100 recipients.", category: "payload" },
  FILE_TOO_LARGE: { code: "FILE_TOO_LARGE", status: 413, message: "Uploaded file exceeds maximum size limit.", category: "payload" },
  REQUEST_BODY_TOO_LARGE: { code: "REQUEST_BODY_TOO_LARGE", status: 413, message: "Request body size exceeds maximum limit.", category: "payload" },
  UNSUPPORTED_MEDIA_TYPE: { code: "UNSUPPORTED_MEDIA_TYPE", status: 415, message: "Unsupported Content-Type header.", category: "media" },
  UNSUPPORTED_ENCODING: { code: "UNSUPPORTED_ENCODING", status: 415, message: "Unsupported Content-Encoding.", category: "media" },
  UNPROCESSABLE_ENTITY: { code: "UNPROCESSABLE_ENTITY", status: 422, message: "Request syntax is valid but semantic validation failed.", category: "semantic" },
  BUSINESS_RULE_VIOLATION: { code: "BUSINESS_RULE_VIOLATION", status: 422, message: "Operation violates a business rule constraint.", category: "semantic" },
  RATE_LIMITED: { code: "RATE_LIMITED", status: 429, message: "Too many requests. Please wait a moment and try again.", category: "rate_limit" },
  RATE_LIMIT_IP: { code: "RATE_LIMIT_IP", status: 429, message: "IP rate limit exceeded. Please back off and try again.", category: "rate_limit" },
  RATE_LIMIT_USER: { code: "RATE_LIMIT_USER", status: 429, message: "User rate limit exceeded.", category: "rate_limit" },
  RATE_LIMIT_WALLET: { code: "RATE_LIMIT_WALLET", status: 429, message: "Wallet rate limit exceeded.", category: "rate_limit" },
  RATE_LIMIT_API_KEY: { code: "RATE_LIMIT_API_KEY", status: 429, message: "API key rate limit exceeded.", category: "rate_limit" },
  RATE_LIMIT_GLOBAL: { code: "RATE_LIMIT_GLOBAL", status: 429, message: "Global service rate limit reached.", category: "rate_limit" },
  RATE_LIMIT_BACKOFF: { code: "RATE_LIMIT_BACKOFF", status: 429, message: "Backoff required before next request.", category: "rate_limit" },
  LEGALLY_RESTRICTED: { code: "LEGALLY_RESTRICTED", status: 451, message: "Access restricted due to legal/compliance requirements.", category: "legal" },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", status: 500, message: "An unexpected internal server error occurred.", category: "server" },
  DATABASE_ERROR: { code: "DATABASE_ERROR", status: 500, message: "A database error occurred.", category: "server" },
  DATABASE_QUERY_FAILED: { code: "DATABASE_QUERY_FAILED", status: 500, message: "Database query execution failed.", category: "server" },
  DATABASE_CONNECTION_FAILED: { code: "DATABASE_CONNECTION_FAILED", status: 500, message: "Database connection failed.", category: "server" },
  DATABASE_TRANSACTION_FAILED: { code: "DATABASE_TRANSACTION_FAILED", status: 500, message: "Database transaction failed to commit.", category: "server" },
  DATABASE_DEADLOCK: { code: "DATABASE_DEADLOCK", status: 500, message: "Database transaction deadlock encountered.", category: "server" },
  FOREIGN_KEY: { code: "FOREIGN_KEY", status: 400, message: "Related record not found.", category: "database" },
  RELATION_VIOLATION: { code: "RELATION_VIOLATION", status: 409, message: "Cannot delete — related records exist.", category: "database" },
  DB_CONNECTION: { code: "DB_CONNECTION", status: 503, message: "Database connection failed.", category: "database" },
  CONTRACT_ERROR: { code: "CONTRACT_ERROR", status: 500, message: "Smart contract execution failed.", category: "contract" },
  CONTRACT_CALL_FAILED: { code: "CONTRACT_CALL_FAILED", status: 500, message: "Call to Soroban contract failed.", category: "contract" },
  CONTRACT_DEPLOY_FAILED: { code: "CONTRACT_DEPLOY_FAILED", status: 500, message: "Contract deployment failed.", category: "contract" },
  CONTRACT_COMPILE_FAILED: { code: "CONTRACT_COMPILE_FAILED", status: 500, message: "WASM compilation or validation failed.", category: "contract" },
  CONTRACT_VERIFY_FAILED: { code: "CONTRACT_VERIFY_FAILED", status: 500, message: "Contract verification failed.", category: "contract" },
  RPC_ERROR: { code: "RPC_ERROR", status: 500, message: "Soroban RPC returned an error.", category: "rpc" },
  RPC_NODE_ERROR: { code: "RPC_NODE_ERROR", status: 500, message: "Soroban RPC node encountered an error.", category: "rpc" },
  NETWORK_ERROR: { code: "NETWORK_ERROR", status: 500, message: "Network error — unable to reach the network.", category: "network" },
  NETWORK_TIMEOUT: { code: "NETWORK_TIMEOUT", status: 500, message: "Network request timed out.", category: "network" },
  STELLAR_ERROR: { code: "STELLAR_ERROR", status: 500, message: "Stellar network transaction failed.", category: "stellar" },
  HORIZON_ERROR: { code: "HORIZON_ERROR", status: 500, message: "Stellar Horizon server returned an error.", category: "stellar" },
  SOROBAN_ERROR: { code: "SOROBAN_ERROR", status: 500, message: "Soroban RPC node returned an error.", category: "stellar" },
  EMAIL_SEND_FAILED: { code: "EMAIL_SEND_FAILED", status: 500, message: "Failed to dispatch transactional email.", category: "server" },
  NOTIFICATION_FAILED: { code: "NOTIFICATION_FAILED", status: 500, message: "Notification delivery failed.", category: "server" },
  WEBHOOK_DELIVERY_FAILED: { code: "WEBHOOK_DELIVERY_FAILED", status: 500, message: "Webhook delivery attempt failed.", category: "server" },
  WEBHOOK_SIGNATURE_INVALID: { code: "WEBHOOK_SIGNATURE_INVALID", status: 500, message: "Webhook HMAC signature generation or validation failed.", category: "server" },
  FILE_UPLOAD_FAILED: { code: "FILE_UPLOAD_FAILED", status: 500, message: "File upload failed.", category: "server" },
  FILE_PROCESSING_FAILED: { code: "FILE_PROCESSING_FAILED", status: 500, message: "File processing failed.", category: "server" },
  EXPORT_FAILED: { code: "EXPORT_FAILED", status: 500, message: "Data export generation failed.", category: "server" },
  IMPORT_FAILED: { code: "IMPORT_FAILED", status: 500, message: "Data import failed.", category: "server" },
  SEARCH_INDEX_ERROR: { code: "SEARCH_INDEX_ERROR", status: 500, message: "Search indexing failed.", category: "server" },
  SEARCH_FAILED: { code: "SEARCH_FAILED", status: 500, message: "Search query failed.", category: "server" },
  CACHE_ERROR: { code: "CACHE_ERROR", status: 500, message: "Cache operation failed.", category: "server" },
  CACHE_MISS: { code: "CACHE_MISS", status: 500, message: "Cache entry miss.", category: "server" },
  CONFIG_ERROR: { code: "CONFIG_ERROR", status: 500, message: "Server configuration error.", category: "server" },
  FEATURE_NOT_ENABLED: { code: "FEATURE_NOT_ENABLED", status: 500, message: "This feature flag is not enabled.", category: "server" },
  MAINTENANCE_MODE: { code: "MAINTENANCE_MODE", status: 500, message: "System is in maintenance mode. Please try again shortly.", category: "server" },
  UNKNOWN_ERROR: { code: "UNKNOWN_ERROR", status: 500, message: "An unknown error occurred.", category: "server" },
  PAYMENT_FAILED: { code: "PAYMENT_FAILED", status: 500, message: "Payment execution failed.", category: "server" },
  TRANSACTION_FAILED: { code: "TRANSACTION_FAILED", status: 500, message: "Stellar transaction failed on network.", category: "server" },
  TRANSACTION_EXPIRED: { code: "TRANSACTION_EXPIRED", status: 500, message: "Transaction submission expired.", category: "server" },
  TRANSACTION_REJECTED: { code: "TRANSACTION_REJECTED", status: 500, message: "Transaction was rejected by ledger consensus.", category: "server" },
  BATCH_PARTIAL_SUCCESS: { code: "BATCH_PARTIAL_SUCCESS", status: 500, message: "Batch partially succeeded with some items failed.", category: "server" },
  BATCH_FAILED: { code: "BATCH_FAILED", status: 500, message: "Batch execution failed completely.", category: "server" },
  MULTISIG_NOT_CONFIGURED: { code: "MULTISIG_NOT_CONFIGURED", status: 500, message: "Multisig configuration is not set up on this account.", category: "server" },
  WALLET_NOT_INSTALLED: { code: "WALLET_NOT_INSTALLED", status: 500, message: "Freighter wallet is not installed. Please install the Freighter browser extension.", category: "wallet" },
  WALLET_CONNECTION_FAILED: { code: "WALLET_CONNECTION_FAILED", status: 500, message: "Failed to connect to wallet extension.", category: "wallet" },
  WALLET_DISCONNECTED: { code: "WALLET_DISCONNECTED", status: 500, message: "Wallet disconnected. Please reconnect your wallet.", category: "wallet" },
  WALLET_NETWORK_MISMATCH: { code: "WALLET_NETWORK_MISMATCH", status: 500, message: "Wallet is connected to the wrong network.", category: "wallet" },
  WALLET_SIGN_FAILED: { code: "WALLET_SIGN_FAILED", status: 500, message: "Wallet signing failed.", category: "wallet" },
  WALLET_SIGN_REJECTED: { code: "WALLET_SIGN_REJECTED", status: 500, message: "Transaction was declined in Freighter.", category: "wallet" },
  WALLET_NOT_SUPPORTED: { code: "WALLET_NOT_SUPPORTED", status: 500, message: "Wallet provider is not supported.", category: "wallet" },
  CONTRACT_UNAVAILABLE: { code: "CONTRACT_UNAVAILABLE", status: 503, message: "Smart contract is temporarily unavailable.", category: "unavailable" },
  SERVICE_UNAVAILABLE: { code: "SERVICE_UNAVAILABLE", status: 503, message: "Service is temporarily unavailable. Please retry shortly.", category: "unavailable" },
  OVERLOADED: { code: "OVERLOADED", status: 503, message: "System is experiencing high load. Please retry.", category: "unavailable" },
  DEPENDENCY_UNAVAILABLE: { code: "DEPENDENCY_UNAVAILABLE", status: 503, message: "External dependency is temporarily offline.", category: "unavailable" },
  STELLAR_UNAVAILABLE: { code: "STELLAR_UNAVAILABLE", status: 503, message: "Stellar network is temporarily unreachable.", category: "unavailable" },
  HORIZON_UNAVAILABLE: { code: "HORIZON_UNAVAILABLE", status: 503, message: "Stellar Horizon RPC is currently unavailable.", category: "unavailable" },
  SOROBAN_UNAVAILABLE: { code: "SOROBAN_UNAVAILABLE", status: 503, message: "Soroban RPC endpoint is currently unavailable.", category: "unavailable" },
  RPC_UNAVAILABLE: { code: "RPC_UNAVAILABLE", status: 503, message: "RPC endpoint is temporarily unavailable.", category: "unavailable" },
  DATABASE_UNAVAILABLE: { code: "DATABASE_UNAVAILABLE", status: 503, message: "Database connection is temporarily unavailable.", category: "unavailable" },
  CACHE_UNAVAILABLE: { code: "CACHE_UNAVAILABLE", status: 503, message: "Cache cluster is temporarily unavailable.", category: "unavailable" },
  EMAIL_UNAVAILABLE: { code: "EMAIL_UNAVAILABLE", status: 503, message: "Email delivery service is temporarily unavailable.", category: "unavailable" },
} as const satisfies Record<string, ErrorTaxonomyEntry>;

export type ErrorTaxonomyCode = keyof typeof ERROR_TAXONOMY;

/**
 * Retrieve a taxonomy entry by machine code.
 */
export function getTaxonomyEntry(code: string): ErrorTaxonomyEntry | undefined {
  return (ERROR_TAXONOMY as Record<string, ErrorTaxonomyEntry>)[code];
}

/**
 * Format an error message using template parameter interpolation.
 * If codeOrTemplate is a known taxonomy code, its template (or message) is used as base.
 * Otherwise, codeOrTemplate is treated as the template string directly.
 * Placeholders like {field} are replaced with corresponding params values.
 */
export function formatErrorMessage(
  codeOrTemplate: string,
  params?: Record<string, string | number>
): string {
  const entry = getTaxonomyEntry(codeOrTemplate);
  const base = entry ? (entry.template || entry.message) : codeOrTemplate;
  if (!params) return entry ? entry.message : codeOrTemplate;
  return Object.entries(params).reduce((str, [key, val]) => {
    return str.replace(new RegExp(`\\{${key}\\}`, "g"), String(val));
  }, base);
}

/**
 * Produce a taxonomy entry, with optional overrides or template params.
 */
export function createTaxonomyError(
  code: string,
  paramsOrOverrides?: Record<string, unknown> | Partial<ErrorTaxonomyEntry>
): ErrorTaxonomyEntry & { details?: unknown } {
  const base = getTaxonomyEntry(code) || {
    code,
    status: 500,
    message: `An unexpected error occurred (${code}).`,
  };

  let message = base.message;
  let details: unknown = undefined;

  if (paramsOrOverrides) {
    if (typeof (paramsOrOverrides as Record<string, unknown>).message === "string") {
      message = (paramsOrOverrides as Record<string, unknown>).message as string;
    } else if (base.template) {
      message = formatErrorMessage(code, paramsOrOverrides as Record<string, string | number>);
    }
    if ((paramsOrOverrides as Record<string, unknown>).details !== undefined) {
      details = (paramsOrOverrides as Record<string, unknown>).details;
    } else if (!("status" in paramsOrOverrides) && !("code" in paramsOrOverrides)) {
      details = paramsOrOverrides;
    }
  }

  return {
    ...base,
    message,
    ...(paramsOrOverrides as Partial<ErrorTaxonomyEntry>),
    details,
  };
}
