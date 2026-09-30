# API error code reference

API errors use the standard envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "amount", "message": "Amount must be greater than zero" }]
  },
  "timestamp": "2026-09-29T10:00:00.000Z"
}
```

`error.code` is the machine-readable identifier and `error.message` is the
message to show or log for that particular response. When present,
`error.details` provides additional structured context. Use the code for
client-side branching; do not parse the message text.

## Catalog

The following table lists every code in `src/lib/error-codes.ts` and its
declared default HTTP status from `ERROR_STATUS`. The code names describe the
typical condition. Codes are grouped by status for lookup; a code's presence
in this catalog does not guarantee that a route currently emits it.

**Messages are not centralized per code.** The API response helpers and route
handlers supply the actual `error.message` at runtime. Some use a standard
message (for example, `validationError` returns "Request validation failed");
others pass a resource-specific or operation-specific message. The
`ERROR_STATUS` map is also not applied automatically by `errorResponse`:
handlers pass the HTTP status explicitly. Treat the status below as the
catalog default and confirm endpoint-specific behavior in the endpoint's
OpenAPI response definition.

| Declared HTTP status | Error codes | Typical condition |
|---:|---|---|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `MISSING_REQUIRED_FIELD`, `INVALID_INPUT`, `INVALID_PAGE`, `INVALID_LIMIT`, `INVALID_SORT`, `INVALID_FILTER`, `INVALID_CURSOR`, `INVALID_FORMAT`, `INVALID_AMOUNT`, `AMOUNT_TOO_SMALL`, `AMOUNT_TOO_LARGE`, `AMOUNT_BELOW_MINIMUM`, `AMOUNT_EXCEEDS_MAXIMUM`, `INVALID_ADDRESS`, `ADDRESS_MALFORMED`, `MISSING_DESTINATION`, `SELF_PAYMENT`, `DESTINATION_INVALID`, `INVALID_MEMO`, `MEMO_REQUIRED`, `MEMO_TOO_LONG`, `MEMO_INVALID_FORMAT`, `INVALID_ASSET`, `ASSET_NOT_SUPPORTED`, `INVALID_TRUSTLINE`, `CSV_IMPORT_ERROR`, `CSV_FORMAT_ERROR`, `CSV_TOO_LARGE`, `CSV_EMPTY`, `CSV_MALFORMED_ROW`, `EXPORT_FORMAT_INVALID`, `EXPORT_TOO_LARGE`, `DATE_RANGE_INVALID`, `DATE_RANGE_TOO_LARGE`, `INVALID_SIGNATURE`, `INVALID_TIMESTAMP`, `INVALID_CHALLENGE`, `CHALLENGE_EXPIRED` | Malformed or invalid input, pagination/filter/file constraints, invalid payment details, or invalid authentication challenge/signature. |
| 400 | `PAYMENT_CANCELLED`, `PAYMENT_EXPIRED`, `PAYMENT_PENDING`, `PAYMENT_ALREADY_PROCESSED`, `STREAM_PAUSED`, `STREAM_RESUMED`, `STREAM_CANCELLED`, `STREAM_COMPLETED`, `BATCH_PROCESSING`, `BATCH_CANCELLED`, `ESCROW_EXPIRED`, `ESCROW_RESOLVED`, `THRESHOLD_NOT_MET`, `INVALID_THRESHOLD`, `SIGNER_LIMIT_EXCEEDED`, `SIGNER_WEIGHT_EXCEEDED`, `SIGNER_WEIGHT_INVALID`, `PROPOSAL_EXPIRED`, `PROPOSAL_CANCELLED`, `PROPOSAL_NOT_ACTIVE`, `VOTING_ENDED`, `VOTING_NOT_STARTED`, `QUORUM_NOT_MET`, `INSUFFICIENT_VOTING_POWER` | A payment, stream, batch, escrow, multisig, or governance operation is in a state that prevents the requested action. |
| 401 | `UNAUTHORIZED`, `INVALID_API_KEY`, `API_KEY_MISSING`, `API_KEY_DISABLED`, `EXPIRED_API_KEY`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `TOKEN_MISSING`, `TOKEN_INVALID`, `SESSION_EXPIRED`, `SESSION_INVALID`, `INVALID_CREDENTIALS` | Authentication is missing, invalid, expired, revoked, or disabled. |
| 402 | `INSUFFICIENT_FUNDS`, `INSUFFICIENT_RESERVE` | The account lacks spendable funds or would violate its required reserve. |
| 403 | `FORBIDDEN`, `INSUFFICIENT_PERMISSIONS`, `INSUFFICIENT_SCOPE`, `ROLE_REQUIRED`, `NOT_OWNER`, `NOT_SIGNER`, `NOT_MEMBER`, `NOT_APPROVER`, `NOT_ADMIN`, `ACCOUNT_DISABLED`, `ACCOUNT_SUSPENDED`, `RESOURCE_LOCKED`, `WALLET_LOCKED`, `REGION_RESTRICTED` | The authenticated caller is not permitted to perform the operation or access the resource. |
| 404 | `NOT_FOUND`, `PAYMENT_NOT_FOUND`, `ESCROW_NOT_FOUND`, `STREAM_NOT_FOUND`, `BATCH_NOT_FOUND`, `WEBHOOK_NOT_FOUND`, `USER_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `WALLET_NOT_FOUND`, `SIGNER_NOT_FOUND`, `ASSET_NOT_FOUND`, `API_KEY_NOT_FOUND`, `KEY_NOT_FOUND`, `TOKEN_NOT_FOUND`, `CONTRACT_NOT_FOUND`, `FUNCTION_NOT_FOUND`, `FILE_NOT_FOUND`, `EXPORT_NOT_FOUND`, `NOTIFICATION_NOT_FOUND`, `ROUTE_NOT_FOUND`, `PROPOSAL_NOT_FOUND` | The requested endpoint or resource does not exist or is not visible to the caller. |
| 405 | `METHOD_NOT_ALLOWED` | The endpoint does not support the requested HTTP method. |
| 406 | `NOT_ACCEPTABLE` | The server cannot produce a representation acceptable to the request. |
| 408 | `REQUEST_TIMEOUT`, `TRANSACTION_TIMEOUT`, `CONTRACT_TIMEOUT`, `RPC_TIMEOUT` | The request or a transaction, contract, or RPC operation exceeded its time limit. |
| 409 | `CONFLICT`, `UNIQUE_CONSTRAINT`, `DUPLICATE_REQUEST`, `STATE_CONFLICT`, `VERSION_CONFLICT`, `SEQUENCE_NUMBER_MISMATCH`, `OPERATION_IN_PROGRESS`, `RESOURCE_IN_USE`, `WALLET_ALREADY_CONNECTED`, `STREAM_ALREADY_ACTIVE`, `ESCROW_ALREADY_FUNDED`, `ESCROW_ALREADY_COMPLETED`, `USER_EXISTS`, `EMAIL_EXISTS`, `WALLET_EXISTS`, `SIGNER_EXISTS`, `WEBHOOK_EXISTS`, `BATCH_CONFLICT`, `ALREADY_APPROVED`, `ALREADY_EXECUTED`, `ALREADY_VOTED`, `PROPOSAL_ALREADY_EXECUTED`, `ESCROW_DISPUTED` | The requested operation conflicts with existing data, concurrent work, or the resource's current state. |
| 410 | `RESOURCE_DELETED`, `CONTRACT_DEPRECATED` | The resource or contract is no longer available. |
| 413 | `PAYLOAD_TOO_LARGE`, `BATCH_TOO_LARGE`, `FILE_TOO_LARGE`, `REQUEST_BODY_TOO_LARGE` | The request, batch, or uploaded file exceeds its allowed size. |
| 415 | `UNSUPPORTED_MEDIA_TYPE`, `UNSUPPORTED_ENCODING` | The request's media type or content encoding is not supported. |
| 422 | `UNPROCESSABLE_ENTITY`, `BUSINESS_RULE_VIOLATION` | The request is syntactically valid but violates a business rule. |
| 429 | `RATE_LIMITED`, `RATE_LIMIT_IP`, `RATE_LIMIT_USER`, `RATE_LIMIT_WALLET`, `RATE_LIMIT_API_KEY`, `RATE_LIMIT_GLOBAL`, `RATE_LIMIT_BACKOFF` | A request limit or backoff policy was reached. Honor `Retry-After` when returned. |
| 451 | `LEGALLY_RESTRICTED` | The operation or resource is restricted for legal reasons. |
| 500 | `INTERNAL_ERROR`, `DATABASE_ERROR`, `DATABASE_QUERY_FAILED`, `DATABASE_CONNECTION_FAILED`, `DATABASE_TRANSACTION_FAILED`, `DATABASE_DEADLOCK`, `CONTRACT_ERROR`, `CONTRACT_CALL_FAILED`, `CONTRACT_DEPLOY_FAILED`, `CONTRACT_COMPILE_FAILED`, `CONTRACT_VERIFY_FAILED`, `RPC_ERROR`, `RPC_NODE_ERROR`, `NETWORK_ERROR`, `NETWORK_TIMEOUT`, `STELLAR_ERROR`, `HORIZON_ERROR`, `SOROBAN_ERROR`, `EMAIL_SEND_FAILED`, `NOTIFICATION_FAILED`, `WEBHOOK_DELIVERY_FAILED`, `WEBHOOK_SIGNATURE_INVALID`, `FILE_UPLOAD_FAILED`, `FILE_PROCESSING_FAILED`, `EXPORT_FAILED`, `IMPORT_FAILED`, `SEARCH_INDEX_ERROR`, `SEARCH_FAILED`, `CACHE_ERROR`, `CACHE_MISS`, `CONFIG_ERROR`, `FEATURE_NOT_ENABLED`, `MAINTENANCE_MODE`, `UNKNOWN_ERROR`, `PAYMENT_FAILED`, `TRANSACTION_FAILED`, `TRANSACTION_EXPIRED`, `TRANSACTION_REJECTED`, `BATCH_PARTIAL_SUCCESS`, `BATCH_FAILED`, `MULTISIG_NOT_CONFIGURED`, `WALLET_NOT_INSTALLED`, `WALLET_CONNECTION_FAILED`, `WALLET_DISCONNECTED`, `WALLET_NETWORK_MISMATCH`, `WALLET_SIGN_FAILED`, `WALLET_SIGN_REJECTED`, `WALLET_NOT_SUPPORTED` | An unexpected server, database, Stellar, contract, integration, wallet, or payment failure. The runtime message may be masked in production. |
| 503 | `CONTRACT_UNAVAILABLE`, `SERVICE_UNAVAILABLE`, `OVERLOADED`, `DEPENDENCY_UNAVAILABLE`, `STELLAR_UNAVAILABLE`, `HORIZON_UNAVAILABLE`, `SOROBAN_UNAVAILABLE`, `RPC_UNAVAILABLE`, `DATABASE_UNAVAILABLE`, `CACHE_UNAVAILABLE`, `EMAIL_UNAVAILABLE` | The service or a required dependency is unavailable or overloaded. |

## Client handling

- Branch on the exact `error.code`; unknown codes should fall back to generic
  error handling so clients remain forward-compatible.
- Read `error.message` from the response for the current user-facing detail.
  Do not assume it is identical across endpoints or stable across releases.
- Use the HTTP status and the endpoint's OpenAPI response definition as
  additional context. The catalog status is not a substitute for the actual
  status returned by a route.
- Treat `details` as optional and endpoint-specific.

The response envelope and route conventions are documented in the
[API endpoint guide](./API_GUIDE.md); the maintained code and status constants
are in [`src/lib/error-codes.ts`](../src/lib/error-codes.ts).
