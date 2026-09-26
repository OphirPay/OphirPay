# Error codes

<!-- AUTO-GENERATED from src/lib/error-codes.ts by scripts/generate-error-docs.ts.
     Do not edit by hand. Run `npm run generate-error-docs`. -->

Every code the API can return in `{ success: false, error: { code, message } }` — 219 in total.

## How to use this table

Branch on `error.code`, not on the message text and not on the numeric value. Messages are user-facing and change; codes are the contract.

```json
{
  "success": false,
  "error": {
    "code": "AMOUNT_BELOW_MINIMUM",
    "message": "Amount is below the configured minimum."
  }
}
```

## Retrying

68 of 219 codes are classed retryable. Retry means *the same request, again* — with a fresh idempotency key if the endpoint has one.

The class is **derived from the HTTP status**, then narrowed by an explicit terminal set in the generator. It is not hand-annotated per row, because a wrong `retryable` here costs a duplicate payment and a confident-looking table is how that happens.

Retryable by status: `408`, `429`, `503` and `5xx` generally.

**The exceptions are the interesting part.** A `409` is not automatically safe to replay — if the payment already landed on Stellar, retrying double-pays. Those rows are listed as terminal in the generator's `RETRY_TERMINAL` set and must stay reviewed.

If you add a conflict code that can follow a partially-applied on-chain write, add it to `RETRY_TERMINAL` in `scripts/generate-error-docs.ts` in the same PR.

## Codes

### 400 — Bad Request (64)

Input the caller can correct. Retrying unchanged will fail the same way.

| Code | Retryable |
| --- | --- |
| `ADDRESS_MALFORMED` | no |
| `AMOUNT_BELOW_MINIMUM` | no |
| `AMOUNT_EXCEEDS_MAXIMUM` | no |
| `AMOUNT_TOO_LARGE` | no |
| `AMOUNT_TOO_SMALL` | no |
| `ASSET_NOT_SUPPORTED` | no |
| `BAD_REQUEST` | no |
| `BATCH_CANCELLED` | no |
| `BATCH_PROCESSING` | no |
| `CHALLENGE_EXPIRED` | no |
| `CSV_EMPTY` | no |
| `CSV_FORMAT_ERROR` | no |
| `CSV_IMPORT_ERROR` | no |
| `CSV_MALFORMED_ROW` | no |
| `CSV_TOO_LARGE` | no |
| `DATE_RANGE_INVALID` | no |
| `DATE_RANGE_TOO_LARGE` | no |
| `DESTINATION_INVALID` | no |
| `ESCROW_EXPIRED` | no |
| `ESCROW_RESOLVED` | no |
| `EXPORT_FORMAT_INVALID` | no |
| `EXPORT_TOO_LARGE` | no |
| `INSUFFICIENT_VOTING_POWER` | no |
| `INVALID_ADDRESS` | no |
| `INVALID_AMOUNT` | no |
| `INVALID_ASSET` | no |
| `INVALID_CHALLENGE` | no |
| `INVALID_CURSOR` | no |
| `INVALID_FILTER` | no |
| `INVALID_FORMAT` | no |
| `INVALID_INPUT` | no |
| `INVALID_LIMIT` | no |
| `INVALID_MEMO` | no |
| `INVALID_PAGE` | no |
| `INVALID_SIGNATURE` | no |
| `INVALID_SORT` | no |
| `INVALID_THRESHOLD` | no |
| `INVALID_TIMESTAMP` | no |
| `INVALID_TRUSTLINE` | no |
| `MEMO_INVALID_FORMAT` | no |
| `MEMO_REQUIRED` | no |
| `MEMO_TOO_LONG` | no |
| `MISSING_DESTINATION` | no |
| `MISSING_REQUIRED_FIELD` | no |
| `PAYMENT_ALREADY_PROCESSED` | no |
| `PAYMENT_CANCELLED` | no |
| `PAYMENT_EXPIRED` | no |
| `PAYMENT_PENDING` | no |
| `PROPOSAL_CANCELLED` | no |
| `PROPOSAL_EXPIRED` | no |
| `PROPOSAL_NOT_ACTIVE` | no |
| `QUORUM_NOT_MET` | no |
| `SELF_PAYMENT` | no |
| `SIGNER_LIMIT_EXCEEDED` | no |
| `SIGNER_WEIGHT_EXCEEDED` | no |
| `SIGNER_WEIGHT_INVALID` | no |
| `STREAM_CANCELLED` | no |
| `STREAM_COMPLETED` | no |
| `STREAM_PAUSED` | no |
| `STREAM_RESUMED` | no |
| `THRESHOLD_NOT_MET` | no |
| `VALIDATION_ERROR` | no |
| `VOTING_ENDED` | no |
| `VOTING_NOT_STARTED` | no |

### 401 — Unauthorized (12)

Credentials missing, expired or invalid. Obtain a new credential first.

| Code | Retryable |
| --- | --- |
| `API_KEY_DISABLED` | no |
| `API_KEY_MISSING` | no |
| `EXPIRED_API_KEY` | no |
| `INVALID_API_KEY` | no |
| `INVALID_CREDENTIALS` | no |
| `SESSION_EXPIRED` | no |
| `SESSION_INVALID` | no |
| `TOKEN_EXPIRED` | no |
| `TOKEN_INVALID` | no |
| `TOKEN_MISSING` | no |
| `TOKEN_REVOKED` | no |
| `UNAUTHORIZED` | no |

### 402 — Payment Required (2)

| Code | Retryable |
| --- | --- |
| `INSUFFICIENT_FUNDS` | no |
| `INSUFFICIENT_RESERVE` | no |

### 403 — Forbidden (14)

Authenticated but not permitted. Retrying does not help.

| Code | Retryable |
| --- | --- |
| `ACCOUNT_DISABLED` | no |
| `ACCOUNT_SUSPENDED` | no |
| `FORBIDDEN` | no |
| `INSUFFICIENT_PERMISSIONS` | no |
| `INSUFFICIENT_SCOPE` | no |
| `NOT_ADMIN` | no |
| `NOT_APPROVER` | no |
| `NOT_MEMBER` | no |
| `NOT_OWNER` | no |
| `NOT_SIGNER` | no |
| `REGION_RESTRICTED` | no |
| `RESOURCE_LOCKED` | no |
| `ROLE_REQUIRED` | no |
| `WALLET_LOCKED` | no |

### 404 — Not Found (21)

The resource does not exist. Retrying does not help.

| Code | Retryable |
| --- | --- |
| `ACCOUNT_NOT_FOUND` | no |
| `API_KEY_NOT_FOUND` | no |
| `ASSET_NOT_FOUND` | no |
| `BATCH_NOT_FOUND` | no |
| `CONTRACT_NOT_FOUND` | no |
| `ESCROW_NOT_FOUND` | no |
| `EXPORT_NOT_FOUND` | no |
| `FILE_NOT_FOUND` | no |
| `FUNCTION_NOT_FOUND` | no |
| `KEY_NOT_FOUND` | no |
| `NOT_FOUND` | no |
| `NOTIFICATION_NOT_FOUND` | no |
| `PAYMENT_NOT_FOUND` | no |
| `PROPOSAL_NOT_FOUND` | no |
| `ROUTE_NOT_FOUND` | no |
| `SIGNER_NOT_FOUND` | no |
| `STREAM_NOT_FOUND` | no |
| `TOKEN_NOT_FOUND` | no |
| `USER_NOT_FOUND` | no |
| `WALLET_NOT_FOUND` | no |
| `WEBHOOK_NOT_FOUND` | no |

### 405 — Method Not Allowed (1)

| Code | Retryable |
| --- | --- |
| `METHOD_NOT_ALLOWED` | no |

### 406 — Not Acceptable (1)

| Code | Retryable |
| --- | --- |
| `NOT_ACCEPTABLE` | no |

### 408 — Request Timeout (4)

| Code | Retryable |
| --- | --- |
| `CONTRACT_TIMEOUT` | yes |
| `REQUEST_TIMEOUT` | yes |
| `RPC_TIMEOUT` | yes |
| `TRANSACTION_TIMEOUT` | yes |

### 409 — Conflict (23)

State conflict. **Read the retryable column** — several of these may already have taken effect on-chain.

| Code | Retryable |
| --- | --- |
| `ALREADY_APPROVED` | no |
| `ALREADY_EXECUTED` | no |
| `ALREADY_VOTED` | no |
| `BATCH_CONFLICT` | no |
| `CONFLICT` | no |
| `DUPLICATE_REQUEST` | no |
| `EMAIL_EXISTS` | no |
| `ESCROW_ALREADY_COMPLETED` | no |
| `ESCROW_ALREADY_FUNDED` | no |
| `ESCROW_DISPUTED` | no |
| `OPERATION_IN_PROGRESS` | no |
| `PROPOSAL_ALREADY_EXECUTED` | no |
| `RESOURCE_IN_USE` | no |
| `SEQUENCE_NUMBER_MISMATCH` | no |
| `SIGNER_EXISTS` | no |
| `STATE_CONFLICT` | no |
| `STREAM_ALREADY_ACTIVE` | no |
| `UNIQUE_CONSTRAINT` | no |
| `USER_EXISTS` | no |
| `VERSION_CONFLICT` | no |
| `WALLET_ALREADY_CONNECTED` | no |
| `WALLET_EXISTS` | no |
| `WEBHOOK_EXISTS` | no |

### 410 — Gone (2)

| Code | Retryable |
| --- | --- |
| `CONTRACT_DEPRECATED` | no |
| `RESOURCE_DELETED` | no |

### 413 — Payload Too Large (4)

| Code | Retryable |
| --- | --- |
| `BATCH_TOO_LARGE` | no |
| `FILE_TOO_LARGE` | no |
| `PAYLOAD_TOO_LARGE` | no |
| `REQUEST_BODY_TOO_LARGE` | no |

### 415 — Unsupported Media Type (2)

| Code | Retryable |
| --- | --- |
| `UNSUPPORTED_ENCODING` | no |
| `UNSUPPORTED_MEDIA_TYPE` | no |

### 422 — Unprocessable Entity (2)

| Code | Retryable |
| --- | --- |
| `BUSINESS_RULE_VIOLATION` | no |
| `UNPROCESSABLE_ENTITY` | no |

### 429 — Too Many Requests (7)

Rate limited. Back off using `Retry-After`.

| Code | Retryable |
| --- | --- |
| `RATE_LIMIT_API_KEY` | yes |
| `RATE_LIMIT_BACKOFF` | yes |
| `RATE_LIMIT_GLOBAL` | yes |
| `RATE_LIMIT_IP` | yes |
| `RATE_LIMIT_USER` | yes |
| `RATE_LIMIT_WALLET` | yes |
| `RATE_LIMITED` | yes |

### 451 — Unavailable For Legal Reasons (1)

| Code | Retryable |
| --- | --- |
| `LEGALLY_RESTRICTED` | no |

### 500 — Internal Server Error (48)

Server-side fault. Generally safe to retry, except the rows marked terminal.

| Code | Retryable |
| --- | --- |
| `BATCH_FAILED` | yes |
| `BATCH_PARTIAL_SUCCESS` | yes |
| `CACHE_ERROR` | yes |
| `CACHE_MISS` | yes |
| `CONFIG_ERROR` | yes |
| `CONTRACT_CALL_FAILED` | yes |
| `CONTRACT_COMPILE_FAILED` | yes |
| `CONTRACT_DEPLOY_FAILED` | yes |
| `CONTRACT_ERROR` | yes |
| `CONTRACT_VERIFY_FAILED` | yes |
| `DATABASE_CONNECTION_FAILED` | yes |
| `DATABASE_DEADLOCK` | yes |
| `DATABASE_ERROR` | yes |
| `DATABASE_QUERY_FAILED` | yes |
| `DATABASE_TRANSACTION_FAILED` | yes |
| `EMAIL_SEND_FAILED` | yes |
| `EXPORT_FAILED` | yes |
| `FEATURE_NOT_ENABLED` | no |
| `FILE_PROCESSING_FAILED` | yes |
| `FILE_UPLOAD_FAILED` | yes |
| `HORIZON_ERROR` | yes |
| `IMPORT_FAILED` | yes |
| `INTERNAL_ERROR` | yes |
| `MAINTENANCE_MODE` | no |
| `MULTISIG_NOT_CONFIGURED` | yes |
| `NETWORK_ERROR` | yes |
| `NETWORK_TIMEOUT` | yes |
| `NOTIFICATION_FAILED` | yes |
| `PAYMENT_FAILED` | yes |
| `RPC_ERROR` | yes |
| `RPC_NODE_ERROR` | yes |
| `SEARCH_FAILED` | yes |
| `SEARCH_INDEX_ERROR` | yes |
| `SOROBAN_ERROR` | yes |
| `STELLAR_ERROR` | yes |
| `TRANSACTION_EXPIRED` | yes |
| `TRANSACTION_FAILED` | yes |
| `TRANSACTION_REJECTED` | yes |
| `UNKNOWN_ERROR` | yes |
| `WALLET_CONNECTION_FAILED` | yes |
| `WALLET_DISCONNECTED` | yes |
| `WALLET_NETWORK_MISMATCH` | yes |
| `WALLET_NOT_INSTALLED` | yes |
| `WALLET_NOT_SUPPORTED` | yes |
| `WALLET_SIGN_FAILED` | yes |
| `WALLET_SIGN_REJECTED` | yes |
| `WEBHOOK_DELIVERY_FAILED` | yes |
| `WEBHOOK_SIGNATURE_INVALID` | yes |

### 503 — Service Unavailable (11)

Dependency unavailable. Retry with backoff.

| Code | Retryable |
| --- | --- |
| `CACHE_UNAVAILABLE` | yes |
| `CONTRACT_UNAVAILABLE` | yes |
| `DATABASE_UNAVAILABLE` | yes |
| `DEPENDENCY_UNAVAILABLE` | yes |
| `EMAIL_UNAVAILABLE` | yes |
| `HORIZON_UNAVAILABLE` | yes |
| `OVERLOADED` | yes |
| `RPC_UNAVAILABLE` | yes |
| `SERVICE_UNAVAILABLE` | yes |
| `SOROBAN_UNAVAILABLE` | yes |
| `STELLAR_UNAVAILABLE` | yes |

## Related

- [API_GUIDE.md](API_GUIDE.md) — the response envelope and the conventions every route follows
- `src/lib/error-codes.ts` — `ERROR_CODES` (the values) and `ERROR_STATUS` (the HTTP status for each)
- `src/lib/error-messages.ts` — user-facing strings. **Not** part of the contract; some are functions of arguments
- `src/lib/contract-errors.ts` — auto-generated from the Rust `PaymentError` enum, for decoding on-chain contract errors. Separate namespace from the codes above.
