#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Generates docs/API_ERRORS.md from src/lib/error-codes.ts and contract-errors.ts.
 * Resolves Issue #778.
 */

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const errorCodesPath = path.join(rootDir, "src/lib/error-codes.ts");
const outputPath = path.join(rootDir, "docs/API_ERRORS.md");

const errorCodesContent = fs.readFileSync(errorCodesPath, "utf-8");

// Parse ERROR_CODES
const codesMatch = errorCodesContent.match(/export const ERROR_CODES = \{([\s\S]*?)\} as const;/);
if (!codesMatch) {
  console.error("Could not parse ERROR_CODES");
  process.exit(1);
}

const codesRaw = codesMatch[1];
const codes = [];
for (const line of codesRaw.split("\n")) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("//") && trimmed.includes(":")) {
    const code = trimmed.split(":")[0].trim();
    codes.push(code);
  }
}

// Parse ERROR_STATUS
const statusMatch = errorCodesContent.match(/export const ERROR_STATUS: Record<string, number> = \{([\s\S]*?)\};/);
if (!statusMatch) {
  console.error("Could not parse ERROR_STATUS");
  process.exit(1);
}

const statusMap = {};
for (const line of statusMatch[1].split("\n")) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith("//") && trimmed.includes(":")) {
    const [code, status] = trimmed.split(":").map(s => s.trim().replace(/,/g, ""));
    statusMap[code] = parseInt(status, 10);
  }
}

// Known retryable codes
const RETRYABLE_SET = new Set([
  // 408 Timeouts
  "REQUEST_TIMEOUT",
  "TRANSACTION_TIMEOUT",
  "CONTRACT_TIMEOUT",
  "RPC_TIMEOUT",

  // 409 Race conditions
  "CONCURRENT_MUTATION",
  "LOCK_TIMEOUT",

  // 429 Rate limits
  "RATE_LIMITED",
  "RATE_LIMIT_EXCEEDED",
  "TOO_MANY_REQUESTS",
  "RATE_LIMIT_BACKOFF",

  // 500 Infrastructure / Transient network
  "DATABASE_DEADLOCK",
  "DATABASE_CONNECTION_FAILED",
  "RPC_ERROR",
  "RPC_NODE_ERROR",
  "NETWORK_ERROR",
  "NETWORK_TIMEOUT",
  "STELLAR_ERROR",
  "HORIZON_ERROR",
  "SOROBAN_ERROR",

  // 503 Service unavailable
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
]);

// Semantic meanings dictionary
const MEANINGS = {
  // 400
  BAD_REQUEST: "Malformed request payload, invalid parameters, or unparseable JSON.",
  VALIDATION_ERROR: "Request body failed schema validation (e.g. Zod validation failure).",
  MISSING_REQUIRED_FIELD: "One or more mandatory parameters or fields were omitted.",
  INVALID_INPUT: "Provided input data is invalid or fails business constraint checks.",
  INVALID_PAGE: "Pagination page number is negative, zero, or non-numeric.",
  INVALID_LIMIT: "Pagination limit is out of allowed range (must be 1–100).",
  INVALID_SORT: "Specified sort column or order ('asc' | 'desc') is not recognized.",
  INVALID_FILTER: "Specified search or query filter parameter is invalid or unsupported.",
  INVALID_CURSOR: "Opaque keyset pagination cursor is malformed or expired.",
  INVALID_FORMAT: "Payload format does not match the expected content type or encoding.",
  INVALID_AMOUNT: "Payment amount must be a positive number formatted with up to 7 decimals.",
  AMOUNT_TOO_SMALL: "Payment amount is below minimum precision or transfer threshold.",
  AMOUNT_TOO_LARGE: "Payment amount exceeds system maximum or available supply.",
  AMOUNT_BELOW_MINIMUM: "Amount is less than minimum required for this operation or asset.",
  AMOUNT_EXCEEDS_MAXIMUM: "Amount exceeds maximum per-transaction limit.",
  INVALID_ADDRESS: "Stellar account address is malformed (must be 56-character StrKey G...).",
  ADDRESS_MALFORMED: "Stellar public key fails base32 StrKey checksum verification.",
  MISSING_DESTINATION: "Destination account address was not provided in the payment request.",
  SELF_PAYMENT: "Sender and recipient addresses are identical; self-transfers are rejected.",
  DESTINATION_INVALID: "Destination account does not exist or cannot receive payments.",
  INVALID_MEMO: "Memo value is invalid for the specified memo type.",
  MEMO_REQUIRED: "Destination account requires a memo (e.g. exchange deposit ID).",
  MEMO_TOO_LONG: "Text memo exceeds Stellar 28-byte limit.",
  MEMO_INVALID_FORMAT: "Memo encoding is invalid (e.g. invalid base64 or non-hex ID).",
  INVALID_ASSET: "Asset specification (code:issuer) is invalid.",
  ASSET_NOT_SUPPORTED: "Asset is not supported on this OphirPay deployment.",
  INVALID_TRUSTLINE: "Destination account lacks an established trustline for the asset.",
  CSV_IMPORT_ERROR: "Batch CSV file could not be parsed or contains syntax errors.",
  CSV_FORMAT_ERROR: "CSV header row does not match the required columns.",
  CSV_TOO_LARGE: "CSV file size exceeds the 5MB upload limit.",
  CSV_EMPTY: "Uploaded CSV contains no recipient rows.",
  CSV_MALFORMED_ROW: "One or more CSV rows contain incorrect column counts or invalid data.",
  EXPORT_FORMAT_INVALID: "Requested export format must be 'csv' or 'json'.",
  EXPORT_TOO_LARGE: "Export row count exceeds maximum exportable limit.",
  DATE_RANGE_INVALID: "Start date must be earlier than end date.",
  DATE_RANGE_TOO_LARGE: "Requested date range exceeds the maximum query interval.",
  INVALID_SIGNATURE: "Cryptographic signature failed verification.",
  INVALID_TIMESTAMP: "Request timestamp is skewed beyond the acceptable 5-minute clock drift.",
  INVALID_CHALLENGE: "SEP-10 challenge transaction is malformed or invalid.",
  CHALLENGE_EXPIRED: "SEP-10 challenge transaction has expired.",
  PAYMENT_CANCELLED: "Payment was cancelled and cannot be modified or processed.",
  PAYMENT_EXPIRED: "Payment request has passed its expiration deadline.",
  PAYMENT_PENDING: "Payment is already awaiting on-chain confirmation.",
  PAYMENT_ALREADY_PROCESSED: "Payment has already completed or been refunded.",
  STREAM_PAUSED: "Payment stream is paused and cannot disburse funds until resumed.",
  STREAM_RESUMED: "Stream state transition conflict: stream is already active.",
  STREAM_CANCELLED: "Payment stream has been terminated by the sender or receiver.",
  STREAM_COMPLETED: "Payment stream duration has elapsed; no remaining balance to vest.",
  BATCH_PROCESSING: "Batch payment is currently executing on-chain; concurrent edits blocked.",
  BATCH_CANCELLED: "Batch was cancelled prior to execution.",
  ESCROW_EXPIRED: "Escrow release deadline has passed without fulfillment.",
  ESCROW_RESOLVED: "Escrow has already been released to beneficiary or refunded to sender.",
  THRESHOLD_NOT_MET: "Multisig signing threshold not reached.",
  INVALID_THRESHOLD: "Requested multisig threshold exceeds total signer weight.",
  SIGNER_LIMIT_EXCEEDED: "Maximum number of multisig signers (20) exceeded.",
  SIGNER_WEIGHT_EXCEEDED: "Combined signer weight exceeds maximum allowable limit.",
  SIGNER_WEIGHT_INVALID: "Signer weight must be a positive integer.",
  PROPOSAL_EXPIRED: "Governance proposal voting window has elapsed.",
  PROPOSAL_CANCELLED: "Governance proposal was cancelled by its author.",
  PROPOSAL_NOT_ACTIVE: "Proposal is not in active voting state.",
  VOTING_ENDED: "Voting on this proposal has concluded.",
  VOTING_NOT_STARTED: "Voting period for this proposal has not begun.",
  QUORUM_NOT_MET: "Total votes cast failed to meet the required quorum threshold.",
  INSUFFICIENT_VOTING_POWER: "Account holds insufficient governance tokens to cast this vote.",

  // 401
  UNAUTHORIZED: "Authentication is required to access this endpoint.",
  INVALID_API_KEY: "The provided API key is invalid or unrecognized.",
  API_KEY_MISSING: "API key was not supplied in the Authorization or x-api-key header.",
  API_KEY_DISABLED: "The API key has been administratively disabled.",
  EXPIRED_API_KEY: "The API key has passed its configured expiration date.",
  TOKEN_EXPIRED: "Bearer JWT access token has expired.",
  TOKEN_REVOKED: "Session token has been explicitly revoked.",
  TOKEN_MISSING: "Authorization Bearer token was omitted from request headers.",
  TOKEN_INVALID: "Bearer token signature is invalid or malformed.",
  SESSION_EXPIRED: "User web session has timed out due to inactivity.",
  SESSION_INVALID: "Session cookie or identifier is corrupt or unrecognized.",
  INVALID_CREDENTIALS: "Email, password, or signature combination did not match.",

  // 402
  INSUFFICIENT_FUNDS: "Account balance is insufficient to execute payment plus network fees.",
  INSUFFICIENT_RESERVE: "Account balance is below the Stellar minimum reserve requirement.",

  // 403
  FORBIDDEN: "Authenticated caller lacks permission to perform this action.",
  INSUFFICIENT_PERMISSIONS: "Caller role does not possess the required RBAC permission.",
  INSUFFICIENT_SCOPE: "API key token lacks the required OAuth/API scope.",
  ROLE_REQUIRED: "This operation requires a specific elevated role (e.g. TREASURER).",
  NOT_OWNER: "Caller is not the registered owner of this resource.",
  NOT_SIGNER: "Caller address is not an authorized signer on this multisig account.",
  NOT_MEMBER: "Caller is not a member of the target organization or DAO.",
  NOT_APPROVER: "Caller does not hold approval authority for this tier of transfer.",
  NOT_ADMIN: "Administrative privileges are required for this action.",
  ACCOUNT_DISABLED: "Account has been deactivated.",
  ACCOUNT_SUSPENDED: "Account has been suspended pending review.",
  RESOURCE_LOCKED: "Resource is locked by another operation or timelock.",
  WALLET_LOCKED: "Hardware or session wallet is currently locked.",
  REGION_RESTRICTED: "Access to this service is restricted in caller's jurisdiction.",

  // 404
  NOT_FOUND: "The requested entity or endpoint does not exist.",
  PAYMENT_NOT_FOUND: "No payment matching the provided ID was found.",
  ESCROW_NOT_FOUND: "No escrow matching the provided ID was found.",
  STREAM_NOT_FOUND: "No streaming contract matching the provided ID was found.",
  BATCH_NOT_FOUND: "No batch payment matching the provided ID was found.",
  WEBHOOK_NOT_FOUND: "No webhook endpoint matching the provided ID was found.",
  USER_NOT_FOUND: "No user account matching the provided ID was found.",
  ACCOUNT_NOT_FOUND: "Stellar account not found on ledger (may be unfunded).",
  WALLET_NOT_FOUND: "Target wallet record was not found.",
  SIGNER_NOT_FOUND: "Target multisig signer address was not found on contract.",
  ASSET_NOT_FOUND: "Asset code or issuer was not found in catalog.",
  API_KEY_NOT_FOUND: "API key matching the key ID was not found.",
  KEY_NOT_FOUND: "Cryptographic public key or signing key was not found.",
  TOKEN_NOT_FOUND: "Specified token contract address was not found.",
  CONTRACT_NOT_FOUND: "Soroban contract instance was not found at specified address.",
  FUNCTION_NOT_FOUND: "Contract method or function was not found in contract ABI.",
  FILE_NOT_FOUND: "Requested export file or attachment was not found.",
  EXPORT_NOT_FOUND: "Requested data export job was not found.",
  NOTIFICATION_NOT_FOUND: "Notification record was not found.",
  ROUTE_NOT_FOUND: "Requested API endpoint route does not exist.",
  PROPOSAL_NOT_FOUND: "Governance proposal was not found.",

  // 405
  METHOD_NOT_ALLOWED: "HTTP request method is not supported on this endpoint.",

  // 406
  NOT_ACCEPTABLE: "Server cannot produce response matching Accept headers.",

  // 408
  REQUEST_TIMEOUT: "HTTP request exceeded server processing timeout.",
  TRANSACTION_TIMEOUT: "On-chain transaction confirmation timed out awaiting inclusion in ledger.",
  CONTRACT_TIMEOUT: "Soroban contract simulation or invocation timed out.",
  RPC_TIMEOUT: "Upstream RPC node response timed out.",

  // 409
  CONFLICT: "Request conflicts with current state of the resource.",
  ALREADY_EXISTS: "Resource with this identifier already exists.",
  DUPLICATE_ENTRY: "A duplicate record was detected for a unique field.",
  DUPLICATE_PAYMENT: "A payment with identical hash or idempotency key already exists.",
  DUPLICATE_ESCROW: "An escrow with this identifier already exists.",
  DUPLICATE_STREAM: "A stream with this identifier already exists.",
  DUPLICATE_BATCH: "A batch with this identifier already exists.",
  DUPLICATE_WEBHOOK: "A webhook endpoint with this URL already exists.",
  DUPLICATE_USER: "A user with this email or username already exists.",
  DUPLICATE_ACCOUNT: "Account is already registered in the system.",
  DUPLICATE_SIGNER: "Address is already a registered multisig signer.",
  DUPLICATE_KEY: "API key name or key hash already exists.",
  ALREADY_PROCESSED: "Transaction or batch has already been processed.",
  ALREADY_APPROVED: "Signer has already submitted approval for this action.",
  ALREADY_REJECTED: "Signer has already rejected this action.",
  ALREADY_EXECUTED: "Timelocked or multisig action has already been executed.",
  ALREADY_REFUNDED: "Payment has already been refunded.",
  ALREADY_CANCELLED: "Entity has already been cancelled.",
  ALREADY_PAUSED: "Contract or feature is already paused.",
  ALREADY_ACTIVE: "Contract or feature is already unpaused and active.",
  ALREADY_CLAIMED: "Stream or escrow funds have already been claimed.",
  IDEMPOTENCY_CONFLICT: "Idempotency key replayed with mismatched request parameters.",
  STATE_MISMATCH: "Current state does not allow the requested transition.",
  NONCE_MISMATCH: "Transaction nonce or sequence number does not match ledger expectation.",
  VERSION_MISMATCH: "Optimistic concurrency version conflict; re-fetch and retry.",
  CONCURRENT_MUTATION: "Concurrent update detected on resource; safe to retry with backoff.",
  LOCK_TIMEOUT: "Acquiring distributed resource lock timed out; safe to retry.",

  // 422
  UNPROCESSABLE_ENTITY: "Request was syntactically correct but failed semantic business rules.",
  BUSINESS_RULE_VIOLATION: "Action violates domain rules (e.g. refund beyond allowed period).",
  INSUFFICIENT_LIQUIDITY: "Liquidity pool reserves are inadequate to fill payment path.",
  SLIPPAGE_EXCEEDED: "Asset exchange price slippage exceeded caller's maximum tolerance.",
  PRICE_DEVIATION_HIGH: "Price deviation between Horizon and oracles exceeds safety bounds.",
  ORACLE_PRICE_STALE: "Oracle price feed data is older than configured staleness threshold.",
  CIRCUIT_BREAKER_TRIGGERED: "Automated risk circuit breaker was triggered; operation halted.",
  LIMIT_EXCEEDED: "Account or organization usage limit has been exceeded.",
  DAILY_LIMIT_EXCEEDED: "Daily cumulative transfer limit has been exceeded.",
  MONTHLY_LIMIT_EXCEEDED: "Monthly cumulative transfer limit has been exceeded.",
  TRANSACTION_LIMIT_EXCEEDED: "Single transaction volume exceeds configured risk cap.",
  DISPUTE_WINDOW_EXPIRED: "Deadline for opening a dispute on this transaction has elapsed.",
  ESCROW_NOT_DUE: "Escrow release condition or timelock has not yet matured.",
  ESCROW_CANNOT_CANCEL: "Escrow terms prohibit cancellation in its current state.",
  STREAM_NOT_STARTED: "Payment stream start time has not arrived.",
  STREAM_CANNOT_CANCEL: "Payment stream cannot be cancelled after full vesting.",
  PROPOSAL_NOT_PASSED: "Proposal did not achieve majority yes votes upon tallying.",
  PROPOSAL_DEFEATED: "Proposal received majority no votes.",
  PROPOSAL_ALREADY_ACTIVE: "Proposal is already active.",
  CANNOT_CANCEL_PROPOSAL: "Proposal status does not permit cancellation.",
  CANNOT_EXECUTE_PROPOSAL: "Proposal has not passed or timelock delay has not elapsed.",
  TIMELOCK_ACTIVE: "Action is locked in 24-hour timelock delay; execution not yet permitted.",
  TIMELOCK_EXPIRED: "Execution grace period following timelock delay has expired.",
  PAUSE_ACTIVE: "Target function is disabled under current scoped pause controls.",
  EMERGENCY_PAUSE_ACTIVE: "System is in emergency full pause mode.",
  TRUSTLINE_MISSING: "Target account must create an asset trustline before receiving tokens.",
  TRUSTLINE_LIMIT_EXCEEDED: "Transfer would exceed recipient trustline holding limit.",
  MEMO_TYPE_MISMATCH: "Memo type does not match destination account requirements.",
  INVALID_SIGNER_WEIGHT: "Assigned multisig signer weight is invalid.",
  SIGNER_ALREADY_REMOVED: "Target signer has already been removed from multisig config.",
  INSUFFICIENT_SIGNATURES: "Transaction contains fewer valid signatures than threshold requires.",
  INVALID_EXPIRATION: "Payment request expiration timestamp must be in the future.",
  EXPIRATION_TOO_FAR: "Payment request expiration exceeds maximum allowed duration (90 days).",

  // 429
  RATE_LIMITED: "Too many requests. Please wait and retry according to Retry-After header.",
  RATE_LIMIT_EXCEEDED: "Per-minute or per-hour API quota exceeded.",
  TOO_MANY_REQUESTS: "Client request frequency exceeds sliding window threshold.",
  RATE_LIMIT_BACKOFF: "Rate limiter enforces exponential backoff penalty.",

  // 451
  LEGALLY_RESTRICTED: "Unavailable for legal, sanction, or compliance reasons.",

  // 500
  INTERNAL_ERROR: "An unexpected internal server error occurred.",
  DATABASE_ERROR: "Relational database operation failed.",
  DATABASE_QUERY_FAILED: "SQL query execution failed.",
  DATABASE_CONNECTION_FAILED: "Could not establish connection to the primary database.",
  DATABASE_TRANSACTION_FAILED: "Database transaction was rolled back due to error.",
  DATABASE_DEADLOCK: "Database transaction deadlock occurred; safe to retry with backoff.",
  CONTRACT_ERROR: "Soroban contract execution halted with an unmapped error code.",
  CONTRACT_CALL_FAILED: "Invoking Soroban contract RPC failed.",
  CONTRACT_DEPLOY_FAILED: "Deploying Soroban contract instance failed.",
  CONTRACT_COMPILE_FAILED: "WASM compilation or validation failed.",
  CONTRACT_VERIFY_FAILED: "Contract address or bytecode verification failed.",
  RPC_ERROR: "Soroban RPC communication error.",
  RPC_NODE_ERROR: "Upstream Soroban RPC node returned an error response.",
  NETWORK_ERROR: "Transient network communication error with upstream provider.",
  NETWORK_TIMEOUT: "Network socket connection timed out.",
  STELLAR_ERROR: "Stellar core ledger operation returned an unexpected error.",
  HORIZON_ERROR: "Horizon REST API returned an unexpected error.",
  SOROBAN_ERROR: "Soroban sub-system returned an unexpected error.",
  EMAIL_SEND_FAILED: "Sending transactional email notification failed.",
  NOTIFICATION_FAILED: "Dispatching push or webhook notification failed.",
  WEBHOOK_DELIVERY_FAILED: "Webhook target server returned 5xx or timed out.",
  WEBHOOK_SIGNATURE_INVALID: "Failed to generate HMAC SHA-256 signature for webhook payload.",
  FILE_UPLOAD_FAILED: "Failed to upload or store file attachment.",
  FILE_PROCESSING_FAILED: "Processing uploaded batch file failed.",
  EXPORT_FAILED: "Generating data export artifact failed.",
  IMPORT_FAILED: "Importing records failed due to internal error.",
  SEARCH_INDEX_ERROR: "Full-text search index synchronization error.",
  SEARCH_FAILED: "Executing search query failed.",
  CACHE_ERROR: "Redis or memory cache operation failed.",
  CACHE_MISS: "Required cache key was missing and reconstruction failed.",
  CONFIG_ERROR: "Server configuration or environment variable is missing or corrupt.",
  FEATURE_NOT_ENABLED: "Requested experimental feature is disabled on this instance.",
  MAINTENANCE_MODE: "OphirPay platform is temporarily offline for scheduled maintenance.",
  UNKNOWN_ERROR: "An unclassified error occurred.",
  PAYMENT_FAILED: "Payment transaction submission failed on ledger.",
  TRANSACTION_FAILED: "Stellar transaction failed during consensus submission.",
  TRANSACTION_EXPIRED: "Transaction submission timed out before inclusion in a ledger.",
  TRANSACTION_REJECTED: "Stellar validators rejected transaction during consensus.",
  BATCH_PARTIAL_SUCCESS: "Some items in batch payment succeeded while others failed.",
  BATCH_FAILED: "Entire batch transaction failed on-chain.",
  MULTISIG_NOT_CONFIGURED: "Multisig configuration is missing on contract.",
  WALLET_NOT_INSTALLED: "Freighter or target wallet extension is not installed in client browser.",
  WALLET_CONNECTION_FAILED: "Connecting to browser wallet extension failed.",
  WALLET_DISCONNECTED: "Wallet extension was disconnected by user.",
  WALLET_NETWORK_MISMATCH: "Wallet is connected to a different Stellar network than the application.",
  WALLET_SIGN_FAILED: "Wallet signing operation failed.",
  WALLET_SIGN_REJECTED: "User declined transaction signature prompt in wallet.",
  WALLET_NOT_SUPPORTED: "Connected wallet does not support requested transaction type.",

  // 503
  CONTRACT_UNAVAILABLE: "Target Soroban smart contract is unavailable or decommissioned.",
  SERVICE_UNAVAILABLE: "OphirPay service is temporarily unable to handle the request.",
  OVERLOADED: "System is experiencing excessive load and shed non-essential requests.",
  DEPENDENCY_UNAVAILABLE: "Critical third-party dependency (RPC, Horizon, or DB) is offline.",
  STELLAR_UNAVAILABLE: "Stellar network Horizon / RPC is currently unreachable.",
  HORIZON_UNAVAILABLE: "Horizon API endpoint is offline or returning 503.",
  SOROBAN_UNAVAILABLE: "Soroban RPC endpoint is offline or returning 503.",
  RPC_UNAVAILABLE: "Configured Soroban RPC cluster is unavailable.",
  DATABASE_UNAVAILABLE: "Primary database cluster is offline or undergoing failover.",
  CACHE_UNAVAILABLE: "Cache cluster is unavailable.",
  EMAIL_UNAVAILABLE: "Email delivery provider is unreachable.",
};

// Generate Markdown
let md = `# 📖 OphirPay API Error Reference & Status Mapping

> **Official Error Catalog**: Comprehensive mapping of all machine error codes returned by the OphirPay API, their corresponding HTTP status codes, operational meanings, and retry policies.
>
> Resolves **Issue #778**.

---

## 1. API Error Response Envelope

All API errors adhere to the standard JSON error envelope defined in \`src/lib/api-response.ts\`:

\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "path": "amount",
        "message": "Payment amount must be greater than zero"
      }
    ]
  },
  "timestamp": "2026-09-24T20:00:00.000Z"
}
\`\`\`

| Field | Type | Description |
|---|---|---|
| \`success\` | \`boolean\` | Always \`false\` on error responses. |
| \`error.code\` | \`string\` | Machine-readable error identifier from the catalog below. |
| \`error.message\` | \`string\` | Human-readable explanation suitable for logging or display. |
| \`error.details\` | \`any\` | Optional field-level error details (e.g. Zod validation issues or contract revert reasons). |
| \`timestamp\` | \`string\` | ISO 8601 timestamp when the error occurred. |

---

## 2. HTTP Status Categories & Retry Guidelines

| HTTP Status | Category | Retryable? | Recommended Client Strategy |
|---|---|---|---|
| **400** | Bad Request / Validation | ⛔ Terminal | Do not retry. Fix client input payload, parameter format, or query strings before resubmitting. |
| **401** | Unauthorized / Authentication | ⛔ Terminal | Do not retry immediately. Refresh credentials, generate a new API key, or prompt user login. |
| **402** | Payment Required / Reserves | ⛔ Terminal | Do not retry immediately. Deposit funds or establish required Stellar reserves before resubmitting. |
| **403** | Forbidden / Authorization | ⛔ Terminal | Do not retry. Request elevated RBAC role or permissions from an administrator. |
| **404** | Not Found | ⛔ Terminal | Do not retry. The resource does not exist or has been deleted. |
| **405** | Method Not Allowed | ⛔ Terminal | Do not retry with the same HTTP verb. Consult API docs for supported methods. |
| **408** | Request Timeout | 🔁 Retryable | **Retryable**. Retry with exponential backoff and jitter. Verify network connectivity. |
| **409** | Conflict / State Mismatch | 🔀 Mixed | **Concurrent mutations and lock timeouts are retryable** with backoff; entity duplication conflicts are terminal. |
| **422** | Unprocessable Entity | ⛔ Terminal | Do not retry. The payload is valid JSON but violates domain rules (e.g. invalid slippage, expired window). |
| **429** | Rate Limited | 🔁 Retryable | **Retryable**. Back off immediately. Read the \`Retry-After\` response header and wait the specified seconds. |
| **451** | Legally Restricted | ⛔ Terminal | Do not retry. Operation blocked for regulatory or sanctions compliance. |
| **500** | Internal Server Error | 🔀 Mixed | **Transient infrastructure errors (network/RPC/database deadlock) are retryable**; logic errors require server fixes. |
| **503** | Service Unavailable | 🔁 Retryable | **Retryable**. Service is temporarily down or overloaded. Retry with exponential backoff and jitter. |

### 🔁 Exponential Backoff Formula
When retrying retryable errors (408, 429, 503, transient 500), use truncated exponential backoff with full jitter:

\`\`\`
sleep_duration = min(max_backoff, base_backoff * (2 ^ attempt)) * random(0.5, 1.0)
\`\`\`

Always pass a consistent \`Idempotency-Key: <UUID>\` header on retried mutating requests (\`POST\`, \`PUT\`, \`PATCH\`) to guarantee operations are executed at most once.

---

## 3. Complete Error Code Catalog (${codes.length} Codes)

Below is the definitive catalog of every machine error code defined in \`src/lib/error-codes.ts\`:

| Error Code | HTTP Status | Policy | Description & Trigger Condition |
|---|---|---|---|
`;

// Group by HTTP status for clean reading
const codesByStatus = {};
for (const code of codes) {
  const status = statusMap[code] || 500;
  if (!codesByStatus[status]) codesByStatus[status] = [];
  codesByStatus[status].push(code);
}

const sortedStatuses = Object.keys(codesByStatus).map(Number).sort((a, b) => a - b);

for (const status of sortedStatuses) {
  for (const code of codesByStatus[status]) {
    const isRetryable = RETRYABLE_SET.has(code);
    const policy = isRetryable ? "🔁 Retryable" : "⛔ Terminal";
    const meaning = MEANINGS[code] || `Error condition: ${code}.`;
    md += `| \`${code}\` | **${status}** | ${policy} | ${meaning} |\n`;
  }
}

md += `
---

## 4. Soroban Smart Contract Error Mapping

Soroban smart contracts in \`contracts/ophirpay/src/lib.rs\` return numeric u32 error codes mapped via \`src/lib/contract-errors.ts\`. When surfaced through API endpoints, they map to HTTP statuses as follows:

| Contract Code | Error Name | HTTP Status | Policy | Description |
|---|---|---|---|---|
| **1** | \`NotInitialized\` | 500 | ⛔ Terminal | Contract instance has not been initialized. |
| **2** | \`AlreadyInitialized\` | 409 | ⛔ Terminal | Contract instance is already initialized. |
| **3** | \`PaymentNotFound\` | 404 | ⛔ Terminal | On-chain payment record does not exist. |
| **4** | \`Unauthorized\` | 403 | ⛔ Terminal | Caller does not possess required owner or signer authority. |
| **5** | \`InvalidAmount\` | 400 | ⛔ Terminal | Amount must be greater than zero. |
| **6** | \`EscrowNotDue\` | 422 | ⛔ Terminal | Escrow release deadline has not elapsed. |
| **7** | \`EscrowAlreadyReleased\` | 409 | ⛔ Terminal | Escrow has already been claimed or released. |
| **8** | \`EscrowNotFound\` | 404 | ⛔ Terminal | Escrow record not found on contract. |
| **9** | \`StreamNotStarted\` | 422 | ⛔ Terminal | Payment stream start time is in the future. |
| **10** | \`StreamAlreadyCancelled\`| 409 | ⛔ Terminal | Payment stream has already been cancelled. |
| **11** | \`StreamNotFound\` | 404 | ⛔ Terminal | Payment stream record not found. |
| **12** | \`StreamFullyClaimed\` | 400 | ⛔ Terminal | All streamed tokens have already been withdrawn. |
| **13** | \`BatchTooLarge\` | 400 | ⛔ Terminal | Batch recipient count exceeds contract maximum (100). |
| **14** | \`BatchEmpty\` | 400 | ⛔ Terminal | Batch contains no recipient transfers. |
| **15** | \`TokenTransferFailed\` | 500 | 🔁 Retryable | Underlying Stellar token contract transfer invocation failed. |
| **16** | \`InsufficientBalance\` | 402 | ⛔ Terminal | Contract or caller lacks required token balance. |
| **17** | \`PaymentAlreadyCancelled\`| 409 | ⛔ Terminal | Payment has already been marked cancelled. |
| **18** | \`ContractPaused\` | 503 | 🔁 Retryable | Operations paused under emergency circuit breaker. |
| **19** | \`NoTokensAvailable\` | 400 | ⛔ Terminal | Balance available for withdrawal is zero. |
| **20** | \`UpgradeNotProposed\` | 400 | ⛔ Terminal | No WASM upgrade proposal is currently pending. |
| **21** | \`UpgradeTimelockActive\`| 422 | ⛔ Terminal | 24-hour timelock delay has not elapsed. |
| **22** | \`MultisigNotConfigured\`| 500 | ⛔ Terminal | Multisig parameters have not been initialized. |
| **23** | \`NotSigner\` | 403 | ⛔ Terminal | Caller is not a registered multisig signer. |
| **24** | \`AlreadyApproved\` | 409 | ⛔ Terminal | Signer has already registered approval. |
| **25** | \`ThresholdNotMet\` | 400 | ⛔ Terminal | Insufficient signer approvals to execute action. |
| **26** | \`AlreadyExecuted\` | 409 | ⛔ Terminal | Timelocked or multisig action has already been executed. |
| **27** | \`NotRoleHolder\` | 403 | ⛔ Terminal | Caller lacks required RBAC role. |
| **34** | \`FeeConfigNotFound\` | 404 | ⛔ Terminal | Dynamic fee configuration not established. |
| **35** | \`FeeTooHigh\` | 400 | ⛔ Terminal | Fee exceeds 1000 bps (10%) safety cap. |
| **36** | \`TimelockedActionNotFound\` | 404 | ⛔ Terminal | Timelocked action ID does not exist. |
| **37** | \`TimelockedActionNotDue\` | 422 | ⛔ Terminal | Timelock delay period has not elapsed. |
| **38** | \`TimelockedActionAlreadyExecuted\` | 409 | ⛔ Terminal | Action was previously dispatched. |
| **40** | \`ProposalNotFound\` | 404 | ⛔ Terminal | Governance proposal does not exist. |
| **52** | \`ReentrantCall\` | 400 | ⛔ Terminal | Cross-contract reentrancy attempt was blocked. |
| **64** | \`RateLimitExceeded\`| 429 | 🔁 Retryable | Contract rate limit exceeded; back off and retry. |
| **77** | \`EmitterNotLinked\` | 500 | ⛔ Terminal | Emitter address unset; see docs/MAINNET_RUNBOOK.md. |

---

## 5. Drift Prevention & Automated Verification

This documentation is verified by automated continuous integration tests in \`src/__tests__/api-errors-table.test.ts\`.

- Every code in \`ERROR_CODES\` must have an entry in \`docs/API_ERRORS.md\`.
- Every HTTP status must match \`ERROR_STATUS\`.
- Adding an error code to \`src/lib/error-codes.ts\` without updating this reference causes CI to fail.
- Run \`node scripts/generate-api-errors-doc.js\` to regenerate or synchronize this document.
`;

fs.writeFileSync(outputPath, md);
console.log(`Generated ${outputPath} with ${codes.length} error codes.`);
