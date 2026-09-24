# 📖 OphirPay API Error Reference & Status Mapping

> **Official Error Catalog**: Comprehensive mapping of all machine error codes returned by the OphirPay API, their corresponding HTTP status codes, operational meanings, and retry policies.
>
> Resolves **Issue #778**.

---

## 1. API Error Response Envelope

All API errors adhere to the standard JSON error envelope defined in `src/lib/api-response.ts`:

```json
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
```

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | Always `false` on error responses. |
| `error.code` | `string` | Machine-readable error identifier from the catalog below. |
| `error.message` | `string` | Human-readable explanation suitable for logging or display. |
| `error.details` | `any` | Optional field-level error details (e.g. Zod validation issues or contract revert reasons). |
| `timestamp` | `string` | ISO 8601 timestamp when the error occurred. |

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
| **429** | Rate Limited | 🔁 Retryable | **Retryable**. Back off immediately. Read the `Retry-After` response header and wait the specified seconds. |
| **451** | Legally Restricted | ⛔ Terminal | Do not retry. Operation blocked for regulatory or sanctions compliance. |
| **500** | Internal Server Error | 🔀 Mixed | **Transient infrastructure errors (network/RPC/database deadlock) are retryable**; logic errors require server fixes. |
| **503** | Service Unavailable | 🔁 Retryable | **Retryable**. Service is temporarily down or overloaded. Retry with exponential backoff and jitter. |

### 🔁 Exponential Backoff Formula
When retrying retryable errors (408, 429, 503, transient 500), use truncated exponential backoff with full jitter:

```
sleep_duration = min(max_backoff, base_backoff * (2 ^ attempt)) * random(0.5, 1.0)
```

Always pass a consistent `Idempotency-Key: <UUID>` header on retried mutating requests (`POST`, `PUT`, `PATCH`) to guarantee operations are executed at most once.

---

## 3. Complete Error Code Catalog (219 Codes)

Below is the definitive catalog of every machine error code defined in `src/lib/error-codes.ts`:

| Error Code | HTTP Status | Policy | Description & Trigger Condition |
|---|---|---|---|
| `BAD_REQUEST` | **400** | ⛔ Terminal | Malformed request payload, invalid parameters, or unparseable JSON. |
| `VALIDATION_ERROR` | **400** | ⛔ Terminal | Request body failed schema validation (e.g. Zod validation failure). |
| `MISSING_REQUIRED_FIELD` | **400** | ⛔ Terminal | One or more mandatory parameters or fields were omitted. |
| `INVALID_INPUT` | **400** | ⛔ Terminal | Provided input data is invalid or fails business constraint checks. |
| `INVALID_PAGE` | **400** | ⛔ Terminal | Pagination page number is negative, zero, or non-numeric. |
| `INVALID_LIMIT` | **400** | ⛔ Terminal | Pagination limit is out of allowed range (must be 1–100). |
| `INVALID_SORT` | **400** | ⛔ Terminal | Specified sort column or order ('asc' | 'desc') is not recognized. |
| `INVALID_FILTER` | **400** | ⛔ Terminal | Specified search or query filter parameter is invalid or unsupported. |
| `INVALID_CURSOR` | **400** | ⛔ Terminal | Opaque keyset pagination cursor is malformed or expired. |
| `INVALID_FORMAT` | **400** | ⛔ Terminal | Payload format does not match the expected content type or encoding. |
| `INVALID_AMOUNT` | **400** | ⛔ Terminal | Payment amount must be a positive number formatted with up to 7 decimals. |
| `AMOUNT_TOO_SMALL` | **400** | ⛔ Terminal | Payment amount is below minimum precision or transfer threshold. |
| `AMOUNT_TOO_LARGE` | **400** | ⛔ Terminal | Payment amount exceeds system maximum or available supply. |
| `AMOUNT_BELOW_MINIMUM` | **400** | ⛔ Terminal | Amount is less than minimum required for this operation or asset. |
| `AMOUNT_EXCEEDS_MAXIMUM` | **400** | ⛔ Terminal | Amount exceeds maximum per-transaction limit. |
| `INVALID_ADDRESS` | **400** | ⛔ Terminal | Stellar account address is malformed (must be 56-character StrKey G...). |
| `ADDRESS_MALFORMED` | **400** | ⛔ Terminal | Stellar public key fails base32 StrKey checksum verification. |
| `MISSING_DESTINATION` | **400** | ⛔ Terminal | Destination account address was not provided in the payment request. |
| `SELF_PAYMENT` | **400** | ⛔ Terminal | Sender and recipient addresses are identical; self-transfers are rejected. |
| `DESTINATION_INVALID` | **400** | ⛔ Terminal | Destination account does not exist or cannot receive payments. |
| `INVALID_MEMO` | **400** | ⛔ Terminal | Memo value is invalid for the specified memo type. |
| `MEMO_REQUIRED` | **400** | ⛔ Terminal | Destination account requires a memo (e.g. exchange deposit ID). |
| `MEMO_TOO_LONG` | **400** | ⛔ Terminal | Text memo exceeds Stellar 28-byte limit. |
| `MEMO_INVALID_FORMAT` | **400** | ⛔ Terminal | Memo encoding is invalid (e.g. invalid base64 or non-hex ID). |
| `INVALID_ASSET` | **400** | ⛔ Terminal | Asset specification (code:issuer) is invalid. |
| `ASSET_NOT_SUPPORTED` | **400** | ⛔ Terminal | Asset is not supported on this OphirPay deployment. |
| `INVALID_TRUSTLINE` | **400** | ⛔ Terminal | Destination account lacks an established trustline for the asset. |
| `CSV_IMPORT_ERROR` | **400** | ⛔ Terminal | Batch CSV file could not be parsed or contains syntax errors. |
| `CSV_FORMAT_ERROR` | **400** | ⛔ Terminal | CSV header row does not match the required columns. |
| `CSV_TOO_LARGE` | **400** | ⛔ Terminal | CSV file size exceeds the 5MB upload limit. |
| `CSV_EMPTY` | **400** | ⛔ Terminal | Uploaded CSV contains no recipient rows. |
| `CSV_MALFORMED_ROW` | **400** | ⛔ Terminal | One or more CSV rows contain incorrect column counts or invalid data. |
| `EXPORT_FORMAT_INVALID` | **400** | ⛔ Terminal | Requested export format must be 'csv' or 'json'. |
| `EXPORT_TOO_LARGE` | **400** | ⛔ Terminal | Export row count exceeds maximum exportable limit. |
| `DATE_RANGE_INVALID` | **400** | ⛔ Terminal | Start date must be earlier than end date. |
| `DATE_RANGE_TOO_LARGE` | **400** | ⛔ Terminal | Requested date range exceeds the maximum query interval. |
| `INVALID_SIGNATURE` | **400** | ⛔ Terminal | Cryptographic signature failed verification. |
| `INVALID_TIMESTAMP` | **400** | ⛔ Terminal | Request timestamp is skewed beyond the acceptable 5-minute clock drift. |
| `INVALID_CHALLENGE` | **400** | ⛔ Terminal | SEP-10 challenge transaction is malformed or invalid. |
| `CHALLENGE_EXPIRED` | **400** | ⛔ Terminal | SEP-10 challenge transaction has expired. |
| `PAYMENT_CANCELLED` | **400** | ⛔ Terminal | Payment was cancelled and cannot be modified or processed. |
| `PAYMENT_EXPIRED` | **400** | ⛔ Terminal | Payment request has passed its expiration deadline. |
| `PAYMENT_PENDING` | **400** | ⛔ Terminal | Payment is already awaiting on-chain confirmation. |
| `PAYMENT_ALREADY_PROCESSED` | **400** | ⛔ Terminal | Payment has already completed or been refunded. |
| `STREAM_PAUSED` | **400** | ⛔ Terminal | Payment stream is paused and cannot disburse funds until resumed. |
| `STREAM_RESUMED` | **400** | ⛔ Terminal | Stream state transition conflict: stream is already active. |
| `STREAM_CANCELLED` | **400** | ⛔ Terminal | Payment stream has been terminated by the sender or receiver. |
| `STREAM_COMPLETED` | **400** | ⛔ Terminal | Payment stream duration has elapsed; no remaining balance to vest. |
| `BATCH_PROCESSING` | **400** | ⛔ Terminal | Batch payment is currently executing on-chain; concurrent edits blocked. |
| `BATCH_CANCELLED` | **400** | ⛔ Terminal | Batch was cancelled prior to execution. |
| `ESCROW_EXPIRED` | **400** | ⛔ Terminal | Escrow release deadline has passed without fulfillment. |
| `ESCROW_RESOLVED` | **400** | ⛔ Terminal | Escrow has already been released to beneficiary or refunded to sender. |
| `THRESHOLD_NOT_MET` | **400** | ⛔ Terminal | Multisig signing threshold not reached. |
| `INVALID_THRESHOLD` | **400** | ⛔ Terminal | Requested multisig threshold exceeds total signer weight. |
| `SIGNER_LIMIT_EXCEEDED` | **400** | ⛔ Terminal | Maximum number of multisig signers (20) exceeded. |
| `SIGNER_WEIGHT_EXCEEDED` | **400** | ⛔ Terminal | Combined signer weight exceeds maximum allowable limit. |
| `SIGNER_WEIGHT_INVALID` | **400** | ⛔ Terminal | Signer weight must be a positive integer. |
| `VOTING_ENDED` | **400** | ⛔ Terminal | Voting on this proposal has concluded. |
| `PROPOSAL_EXPIRED` | **400** | ⛔ Terminal | Governance proposal voting window has elapsed. |
| `PROPOSAL_CANCELLED` | **400** | ⛔ Terminal | Governance proposal was cancelled by its author. |
| `PROPOSAL_NOT_ACTIVE` | **400** | ⛔ Terminal | Proposal is not in active voting state. |
| `VOTING_NOT_STARTED` | **400** | ⛔ Terminal | Voting period for this proposal has not begun. |
| `QUORUM_NOT_MET` | **400** | ⛔ Terminal | Total votes cast failed to meet the required quorum threshold. |
| `INSUFFICIENT_VOTING_POWER` | **400** | ⛔ Terminal | Account holds insufficient governance tokens to cast this vote. |
| `UNAUTHORIZED` | **401** | ⛔ Terminal | Authentication is required to access this endpoint. |
| `INVALID_API_KEY` | **401** | ⛔ Terminal | The provided API key is invalid or unrecognized. |
| `API_KEY_MISSING` | **401** | ⛔ Terminal | API key was not supplied in the Authorization or x-api-key header. |
| `API_KEY_DISABLED` | **401** | ⛔ Terminal | The API key has been administratively disabled. |
| `EXPIRED_API_KEY` | **401** | ⛔ Terminal | The API key has passed its configured expiration date. |
| `TOKEN_EXPIRED` | **401** | ⛔ Terminal | Bearer JWT access token has expired. |
| `TOKEN_REVOKED` | **401** | ⛔ Terminal | Session token has been explicitly revoked. |
| `TOKEN_MISSING` | **401** | ⛔ Terminal | Authorization Bearer token was omitted from request headers. |
| `TOKEN_INVALID` | **401** | ⛔ Terminal | Bearer token signature is invalid or malformed. |
| `SESSION_EXPIRED` | **401** | ⛔ Terminal | User web session has timed out due to inactivity. |
| `SESSION_INVALID` | **401** | ⛔ Terminal | Session cookie or identifier is corrupt or unrecognized. |
| `INVALID_CREDENTIALS` | **401** | ⛔ Terminal | Email, password, or signature combination did not match. |
| `INSUFFICIENT_FUNDS` | **402** | ⛔ Terminal | Account balance is insufficient to execute payment plus network fees. |
| `INSUFFICIENT_RESERVE` | **402** | ⛔ Terminal | Account balance is below the Stellar minimum reserve requirement. |
| `FORBIDDEN` | **403** | ⛔ Terminal | Authenticated caller lacks permission to perform this action. |
| `INSUFFICIENT_PERMISSIONS` | **403** | ⛔ Terminal | Caller role does not possess the required RBAC permission. |
| `INSUFFICIENT_SCOPE` | **403** | ⛔ Terminal | API key token lacks the required OAuth/API scope. |
| `ROLE_REQUIRED` | **403** | ⛔ Terminal | This operation requires a specific elevated role (e.g. TREASURER). |
| `NOT_OWNER` | **403** | ⛔ Terminal | Caller is not the registered owner of this resource. |
| `NOT_SIGNER` | **403** | ⛔ Terminal | Caller address is not an authorized signer on this multisig account. |
| `NOT_MEMBER` | **403** | ⛔ Terminal | Caller is not a member of the target organization or DAO. |
| `NOT_APPROVER` | **403** | ⛔ Terminal | Caller does not hold approval authority for this tier of transfer. |
| `NOT_ADMIN` | **403** | ⛔ Terminal | Administrative privileges are required for this action. |
| `ACCOUNT_DISABLED` | **403** | ⛔ Terminal | Account has been deactivated. |
| `ACCOUNT_SUSPENDED` | **403** | ⛔ Terminal | Account has been suspended pending review. |
| `RESOURCE_LOCKED` | **403** | ⛔ Terminal | Resource is locked by another operation or timelock. |
| `WALLET_LOCKED` | **403** | ⛔ Terminal | Hardware or session wallet is currently locked. |
| `REGION_RESTRICTED` | **403** | ⛔ Terminal | Access to this service is restricted in caller's jurisdiction. |
| `NOT_FOUND` | **404** | ⛔ Terminal | The requested entity or endpoint does not exist. |
| `PAYMENT_NOT_FOUND` | **404** | ⛔ Terminal | No payment matching the provided ID was found. |
| `ESCROW_NOT_FOUND` | **404** | ⛔ Terminal | No escrow matching the provided ID was found. |
| `STREAM_NOT_FOUND` | **404** | ⛔ Terminal | No streaming contract matching the provided ID was found. |
| `BATCH_NOT_FOUND` | **404** | ⛔ Terminal | No batch payment matching the provided ID was found. |
| `WEBHOOK_NOT_FOUND` | **404** | ⛔ Terminal | No webhook endpoint matching the provided ID was found. |
| `USER_NOT_FOUND` | **404** | ⛔ Terminal | No user account matching the provided ID was found. |
| `ACCOUNT_NOT_FOUND` | **404** | ⛔ Terminal | Stellar account not found on ledger (may be unfunded). |
| `WALLET_NOT_FOUND` | **404** | ⛔ Terminal | Target wallet record was not found. |
| `SIGNER_NOT_FOUND` | **404** | ⛔ Terminal | Target multisig signer address was not found on contract. |
| `ASSET_NOT_FOUND` | **404** | ⛔ Terminal | Asset code or issuer was not found in catalog. |
| `API_KEY_NOT_FOUND` | **404** | ⛔ Terminal | API key matching the key ID was not found. |
| `KEY_NOT_FOUND` | **404** | ⛔ Terminal | Cryptographic public key or signing key was not found. |
| `TOKEN_NOT_FOUND` | **404** | ⛔ Terminal | Specified token contract address was not found. |
| `CONTRACT_NOT_FOUND` | **404** | ⛔ Terminal | Soroban contract instance was not found at specified address. |
| `FUNCTION_NOT_FOUND` | **404** | ⛔ Terminal | Contract method or function was not found in contract ABI. |
| `FILE_NOT_FOUND` | **404** | ⛔ Terminal | Requested export file or attachment was not found. |
| `EXPORT_NOT_FOUND` | **404** | ⛔ Terminal | Requested data export job was not found. |
| `NOTIFICATION_NOT_FOUND` | **404** | ⛔ Terminal | Notification record was not found. |
| `ROUTE_NOT_FOUND` | **404** | ⛔ Terminal | Requested API endpoint route does not exist. |
| `PROPOSAL_NOT_FOUND` | **404** | ⛔ Terminal | Governance proposal was not found. |
| `METHOD_NOT_ALLOWED` | **405** | ⛔ Terminal | HTTP request method is not supported on this endpoint. |
| `NOT_ACCEPTABLE` | **406** | ⛔ Terminal | Server cannot produce response matching Accept headers. |
| `REQUEST_TIMEOUT` | **408** | 🔁 Retryable | HTTP request exceeded server processing timeout. |
| `TRANSACTION_TIMEOUT` | **408** | 🔁 Retryable | On-chain transaction confirmation timed out awaiting inclusion in ledger. |
| `CONTRACT_TIMEOUT` | **408** | 🔁 Retryable | Soroban contract simulation or invocation timed out. |
| `RPC_TIMEOUT` | **408** | 🔁 Retryable | Upstream RPC node response timed out. |
| `CONFLICT` | **409** | ⛔ Terminal | Request conflicts with current state of the resource. |
| `UNIQUE_CONSTRAINT` | **409** | ⛔ Terminal | Error condition: UNIQUE_CONSTRAINT. |
| `DUPLICATE_REQUEST` | **409** | ⛔ Terminal | Error condition: DUPLICATE_REQUEST. |
| `STATE_CONFLICT` | **409** | ⛔ Terminal | Error condition: STATE_CONFLICT. |
| `VERSION_CONFLICT` | **409** | ⛔ Terminal | Error condition: VERSION_CONFLICT. |
| `SEQUENCE_NUMBER_MISMATCH` | **409** | ⛔ Terminal | Error condition: SEQUENCE_NUMBER_MISMATCH. |
| `OPERATION_IN_PROGRESS` | **409** | ⛔ Terminal | Error condition: OPERATION_IN_PROGRESS. |
| `RESOURCE_IN_USE` | **409** | ⛔ Terminal | Error condition: RESOURCE_IN_USE. |
| `WALLET_ALREADY_CONNECTED` | **409** | ⛔ Terminal | Error condition: WALLET_ALREADY_CONNECTED. |
| `STREAM_ALREADY_ACTIVE` | **409** | ⛔ Terminal | Error condition: STREAM_ALREADY_ACTIVE. |
| `ESCROW_ALREADY_FUNDED` | **409** | ⛔ Terminal | Error condition: ESCROW_ALREADY_FUNDED. |
| `ESCROW_ALREADY_COMPLETED` | **409** | ⛔ Terminal | Error condition: ESCROW_ALREADY_COMPLETED. |
| `USER_EXISTS` | **409** | ⛔ Terminal | Error condition: USER_EXISTS. |
| `EMAIL_EXISTS` | **409** | ⛔ Terminal | Error condition: EMAIL_EXISTS. |
| `WALLET_EXISTS` | **409** | ⛔ Terminal | Error condition: WALLET_EXISTS. |
| `SIGNER_EXISTS` | **409** | ⛔ Terminal | Error condition: SIGNER_EXISTS. |
| `WEBHOOK_EXISTS` | **409** | ⛔ Terminal | Error condition: WEBHOOK_EXISTS. |
| `BATCH_CONFLICT` | **409** | ⛔ Terminal | Error condition: BATCH_CONFLICT. |
| `ESCROW_DISPUTED` | **409** | ⛔ Terminal | Error condition: ESCROW_DISPUTED. |
| `ALREADY_APPROVED` | **409** | ⛔ Terminal | Signer has already submitted approval for this action. |
| `ALREADY_EXECUTED` | **409** | ⛔ Terminal | Timelocked or multisig action has already been executed. |
| `PROPOSAL_ALREADY_EXECUTED` | **409** | ⛔ Terminal | Error condition: PROPOSAL_ALREADY_EXECUTED. |
| `ALREADY_VOTED` | **409** | ⛔ Terminal | Error condition: ALREADY_VOTED. |
| `RESOURCE_DELETED` | **410** | ⛔ Terminal | Error condition: RESOURCE_DELETED. |
| `CONTRACT_DEPRECATED` | **410** | ⛔ Terminal | Error condition: CONTRACT_DEPRECATED. |
| `PAYLOAD_TOO_LARGE` | **413** | ⛔ Terminal | Error condition: PAYLOAD_TOO_LARGE. |
| `BATCH_TOO_LARGE` | **413** | ⛔ Terminal | Error condition: BATCH_TOO_LARGE. |
| `FILE_TOO_LARGE` | **413** | ⛔ Terminal | Error condition: FILE_TOO_LARGE. |
| `REQUEST_BODY_TOO_LARGE` | **413** | ⛔ Terminal | Error condition: REQUEST_BODY_TOO_LARGE. |
| `UNSUPPORTED_MEDIA_TYPE` | **415** | ⛔ Terminal | Error condition: UNSUPPORTED_MEDIA_TYPE. |
| `UNSUPPORTED_ENCODING` | **415** | ⛔ Terminal | Error condition: UNSUPPORTED_ENCODING. |
| `UNPROCESSABLE_ENTITY` | **422** | ⛔ Terminal | Request was syntactically correct but failed semantic business rules. |
| `BUSINESS_RULE_VIOLATION` | **422** | ⛔ Terminal | Action violates domain rules (e.g. refund beyond allowed period). |
| `RATE_LIMITED` | **429** | 🔁 Retryable | Too many requests. Please wait and retry according to Retry-After header. |
| `RATE_LIMIT_IP` | **429** | ⛔ Terminal | Error condition: RATE_LIMIT_IP. |
| `RATE_LIMIT_USER` | **429** | ⛔ Terminal | Error condition: RATE_LIMIT_USER. |
| `RATE_LIMIT_WALLET` | **429** | ⛔ Terminal | Error condition: RATE_LIMIT_WALLET. |
| `RATE_LIMIT_API_KEY` | **429** | ⛔ Terminal | Error condition: RATE_LIMIT_API_KEY. |
| `RATE_LIMIT_GLOBAL` | **429** | ⛔ Terminal | Error condition: RATE_LIMIT_GLOBAL. |
| `RATE_LIMIT_BACKOFF` | **429** | 🔁 Retryable | Rate limiter enforces exponential backoff penalty. |
| `LEGALLY_RESTRICTED` | **451** | ⛔ Terminal | Unavailable for legal, sanction, or compliance reasons. |
| `INTERNAL_ERROR` | **500** | ⛔ Terminal | An unexpected internal server error occurred. |
| `DATABASE_ERROR` | **500** | ⛔ Terminal | Relational database operation failed. |
| `DATABASE_QUERY_FAILED` | **500** | ⛔ Terminal | SQL query execution failed. |
| `DATABASE_CONNECTION_FAILED` | **500** | 🔁 Retryable | Could not establish connection to the primary database. |
| `DATABASE_TRANSACTION_FAILED` | **500** | ⛔ Terminal | Database transaction was rolled back due to error. |
| `DATABASE_DEADLOCK` | **500** | 🔁 Retryable | Database transaction deadlock occurred; safe to retry with backoff. |
| `CONTRACT_ERROR` | **500** | ⛔ Terminal | Soroban contract execution halted with an unmapped error code. |
| `CONTRACT_CALL_FAILED` | **500** | ⛔ Terminal | Invoking Soroban contract RPC failed. |
| `CONTRACT_DEPLOY_FAILED` | **500** | ⛔ Terminal | Deploying Soroban contract instance failed. |
| `CONTRACT_COMPILE_FAILED` | **500** | ⛔ Terminal | WASM compilation or validation failed. |
| `CONTRACT_VERIFY_FAILED` | **500** | ⛔ Terminal | Contract address or bytecode verification failed. |
| `RPC_ERROR` | **500** | 🔁 Retryable | Soroban RPC communication error. |
| `RPC_NODE_ERROR` | **500** | 🔁 Retryable | Upstream Soroban RPC node returned an error response. |
| `NETWORK_ERROR` | **500** | 🔁 Retryable | Transient network communication error with upstream provider. |
| `NETWORK_TIMEOUT` | **500** | 🔁 Retryable | Network socket connection timed out. |
| `STELLAR_ERROR` | **500** | 🔁 Retryable | Stellar core ledger operation returned an unexpected error. |
| `HORIZON_ERROR` | **500** | 🔁 Retryable | Horizon REST API returned an unexpected error. |
| `SOROBAN_ERROR` | **500** | 🔁 Retryable | Soroban sub-system returned an unexpected error. |
| `EMAIL_SEND_FAILED` | **500** | ⛔ Terminal | Sending transactional email notification failed. |
| `NOTIFICATION_FAILED` | **500** | ⛔ Terminal | Dispatching push or webhook notification failed. |
| `WEBHOOK_DELIVERY_FAILED` | **500** | ⛔ Terminal | Webhook target server returned 5xx or timed out. |
| `WEBHOOK_SIGNATURE_INVALID` | **500** | ⛔ Terminal | Failed to generate HMAC SHA-256 signature for webhook payload. |
| `FILE_UPLOAD_FAILED` | **500** | ⛔ Terminal | Failed to upload or store file attachment. |
| `FILE_PROCESSING_FAILED` | **500** | ⛔ Terminal | Processing uploaded batch file failed. |
| `EXPORT_FAILED` | **500** | ⛔ Terminal | Generating data export artifact failed. |
| `IMPORT_FAILED` | **500** | ⛔ Terminal | Importing records failed due to internal error. |
| `SEARCH_INDEX_ERROR` | **500** | ⛔ Terminal | Full-text search index synchronization error. |
| `SEARCH_FAILED` | **500** | ⛔ Terminal | Executing search query failed. |
| `CACHE_ERROR` | **500** | ⛔ Terminal | Redis or memory cache operation failed. |
| `CACHE_MISS` | **500** | ⛔ Terminal | Required cache key was missing and reconstruction failed. |
| `CONFIG_ERROR` | **500** | ⛔ Terminal | Server configuration or environment variable is missing or corrupt. |
| `FEATURE_NOT_ENABLED` | **500** | ⛔ Terminal | Requested experimental feature is disabled on this instance. |
| `MAINTENANCE_MODE` | **500** | ⛔ Terminal | OphirPay platform is temporarily offline for scheduled maintenance. |
| `UNKNOWN_ERROR` | **500** | ⛔ Terminal | An unclassified error occurred. |
| `PAYMENT_FAILED` | **500** | ⛔ Terminal | Payment transaction submission failed on ledger. |
| `TRANSACTION_FAILED` | **500** | ⛔ Terminal | Stellar transaction failed during consensus submission. |
| `TRANSACTION_EXPIRED` | **500** | ⛔ Terminal | Transaction submission timed out before inclusion in a ledger. |
| `TRANSACTION_REJECTED` | **500** | ⛔ Terminal | Stellar validators rejected transaction during consensus. |
| `BATCH_PARTIAL_SUCCESS` | **500** | ⛔ Terminal | Some items in batch payment succeeded while others failed. |
| `BATCH_FAILED` | **500** | ⛔ Terminal | Entire batch transaction failed on-chain. |
| `MULTISIG_NOT_CONFIGURED` | **500** | ⛔ Terminal | Multisig configuration is missing on contract. |
| `WALLET_NOT_INSTALLED` | **500** | ⛔ Terminal | Freighter or target wallet extension is not installed in client browser. |
| `WALLET_CONNECTION_FAILED` | **500** | ⛔ Terminal | Connecting to browser wallet extension failed. |
| `WALLET_DISCONNECTED` | **500** | ⛔ Terminal | Wallet extension was disconnected by user. |
| `WALLET_NETWORK_MISMATCH` | **500** | ⛔ Terminal | Wallet is connected to a different Stellar network than the application. |
| `WALLET_SIGN_FAILED` | **500** | ⛔ Terminal | Wallet signing operation failed. |
| `WALLET_SIGN_REJECTED` | **500** | ⛔ Terminal | User declined transaction signature prompt in wallet. |
| `WALLET_NOT_SUPPORTED` | **500** | ⛔ Terminal | Connected wallet does not support requested transaction type. |
| `CONTRACT_UNAVAILABLE` | **503** | 🔁 Retryable | Target Soroban smart contract is unavailable or decommissioned. |
| `SERVICE_UNAVAILABLE` | **503** | 🔁 Retryable | OphirPay service is temporarily unable to handle the request. |
| `OVERLOADED` | **503** | 🔁 Retryable | System is experiencing excessive load and shed non-essential requests. |
| `DEPENDENCY_UNAVAILABLE` | **503** | 🔁 Retryable | Critical third-party dependency (RPC, Horizon, or DB) is offline. |
| `STELLAR_UNAVAILABLE` | **503** | 🔁 Retryable | Stellar network Horizon / RPC is currently unreachable. |
| `HORIZON_UNAVAILABLE` | **503** | 🔁 Retryable | Horizon API endpoint is offline or returning 503. |
| `SOROBAN_UNAVAILABLE` | **503** | 🔁 Retryable | Soroban RPC endpoint is offline or returning 503. |
| `RPC_UNAVAILABLE` | **503** | 🔁 Retryable | Configured Soroban RPC cluster is unavailable. |
| `DATABASE_UNAVAILABLE` | **503** | 🔁 Retryable | Primary database cluster is offline or undergoing failover. |
| `CACHE_UNAVAILABLE` | **503** | 🔁 Retryable | Cache cluster is unavailable. |
| `EMAIL_UNAVAILABLE` | **503** | 🔁 Retryable | Email delivery provider is unreachable. |

---

## 4. Soroban Smart Contract Error Mapping

Soroban smart contracts in `contracts/ophirpay/src/lib.rs` return numeric u32 error codes mapped via `src/lib/contract-errors.ts`. When surfaced through API endpoints, they map to HTTP statuses as follows:

| Contract Code | Error Name | HTTP Status | Policy | Description |
|---|---|---|---|---|
| **1** | `NotInitialized` | 500 | ⛔ Terminal | Contract instance has not been initialized. |
| **2** | `AlreadyInitialized` | 409 | ⛔ Terminal | Contract instance is already initialized. |
| **3** | `PaymentNotFound` | 404 | ⛔ Terminal | On-chain payment record does not exist. |
| **4** | `Unauthorized` | 403 | ⛔ Terminal | Caller does not possess required owner or signer authority. |
| **5** | `InvalidAmount` | 400 | ⛔ Terminal | Amount must be greater than zero. |
| **6** | `EscrowNotDue` | 422 | ⛔ Terminal | Escrow release deadline has not elapsed. |
| **7** | `EscrowAlreadyReleased` | 409 | ⛔ Terminal | Escrow has already been claimed or released. |
| **8** | `EscrowNotFound` | 404 | ⛔ Terminal | Escrow record not found on contract. |
| **9** | `StreamNotStarted` | 422 | ⛔ Terminal | Payment stream start time is in the future. |
| **10** | `StreamAlreadyCancelled`| 409 | ⛔ Terminal | Payment stream has already been cancelled. |
| **11** | `StreamNotFound` | 404 | ⛔ Terminal | Payment stream record not found. |
| **12** | `StreamFullyClaimed` | 400 | ⛔ Terminal | All streamed tokens have already been withdrawn. |
| **13** | `BatchTooLarge` | 400 | ⛔ Terminal | Batch recipient count exceeds contract maximum (100). |
| **14** | `BatchEmpty` | 400 | ⛔ Terminal | Batch contains no recipient transfers. |
| **15** | `TokenTransferFailed` | 500 | 🔁 Retryable | Underlying Stellar token contract transfer invocation failed. |
| **16** | `InsufficientBalance` | 402 | ⛔ Terminal | Contract or caller lacks required token balance. |
| **17** | `PaymentAlreadyCancelled`| 409 | ⛔ Terminal | Payment has already been marked cancelled. |
| **18** | `ContractPaused` | 503 | 🔁 Retryable | Operations paused under emergency circuit breaker. |
| **19** | `NoTokensAvailable` | 400 | ⛔ Terminal | Balance available for withdrawal is zero. |
| **20** | `UpgradeNotProposed` | 400 | ⛔ Terminal | No WASM upgrade proposal is currently pending. |
| **21** | `UpgradeTimelockActive`| 422 | ⛔ Terminal | 24-hour timelock delay has not elapsed. |
| **22** | `MultisigNotConfigured`| 500 | ⛔ Terminal | Multisig parameters have not been initialized. |
| **23** | `NotSigner` | 403 | ⛔ Terminal | Caller is not a registered multisig signer. |
| **24** | `AlreadyApproved` | 409 | ⛔ Terminal | Signer has already registered approval. |
| **25** | `ThresholdNotMet` | 400 | ⛔ Terminal | Insufficient signer approvals to execute action. |
| **26** | `AlreadyExecuted` | 409 | ⛔ Terminal | Timelocked or multisig action has already been executed. |
| **27** | `NotRoleHolder` | 403 | ⛔ Terminal | Caller lacks required RBAC role. |
| **34** | `FeeConfigNotFound` | 404 | ⛔ Terminal | Dynamic fee configuration not established. |
| **35** | `FeeTooHigh` | 400 | ⛔ Terminal | Fee exceeds 1000 bps (10%) safety cap. |
| **36** | `TimelockedActionNotFound` | 404 | ⛔ Terminal | Timelocked action ID does not exist. |
| **37** | `TimelockedActionNotDue` | 422 | ⛔ Terminal | Timelock delay period has not elapsed. |
| **38** | `TimelockedActionAlreadyExecuted` | 409 | ⛔ Terminal | Action was previously dispatched. |
| **40** | `ProposalNotFound` | 404 | ⛔ Terminal | Governance proposal does not exist. |
| **52** | `ReentrantCall` | 400 | ⛔ Terminal | Cross-contract reentrancy attempt was blocked. |
| **64** | `RateLimitExceeded`| 429 | 🔁 Retryable | Contract rate limit exceeded; back off and retry. |
| **77** | `EmitterNotLinked` | 500 | ⛔ Terminal | Emitter address unset; see docs/MAINNET_RUNBOOK.md. |

---

## 5. Drift Prevention & Automated Verification

This documentation is verified by automated continuous integration tests in `src/__tests__/api-errors-table.test.ts`.

- Every code in `ERROR_CODES` must have an entry in `docs/API_ERRORS.md`.
- Every HTTP status must match `ERROR_STATUS`.
- Adding an error code to `src/lib/error-codes.ts` without updating this reference causes CI to fail.
- Run `node scripts/generate-api-errors-doc.js` to regenerate or synchronize this document.
