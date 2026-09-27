# Refunds and reason-code analytics

Refunds are represented on-chain by a typed `Refund` record. The free-text
`reason` is for operator context; integrations should use `reason_code` for
stable filtering and analytics.

## Reason-code catalog

The contract assigns the following stable numeric codes:

| Code | Variant | Meaning |
| ---: | --- | --- |
| 0 | `ProductDefect` | The delivered product or service was defective or materially did not match the agreement. |
| 1 | `NonDelivery` | The product or service was not delivered. |
| 2 | `DuplicateCharge` | The payer was charged more than once for the same payment. |
| 3 | `Unauthorized` | The payment was not authorized by the payer. |
| 4 | `CustomerRequest` | The customer requested a refund for another valid business reason. |
| 5 | `Other` | A reason that does not fit the listed categories; explain it in `reason`. |

Reason codes are descriptive and do not themselves determine whether a refund
is full or partial. `amount` is the authoritative refund amount and must be
positive, no greater than the recorded payment amount, and use the payment’s
asset. The contract currently accepts the same code set for either amount.

## Lifecycle and authorization

1. **Request** — `request_refund` creates a `Requested` record. The requester
   must authenticate and be the payment payer or payee. The payment must exist,
   not be cancelled, and the amount and asset must match its limits.
2. **Approve** — `approve_refund` is authenticated owner-only and changes
   `Requested` to `Approved`.
3. **Reject** — `reject_refund` is authenticated owner-only and changes
   `Requested` to `Rejected`.
4. **Process** — `process_refund` is authenticated owner-only, requires
   `Approved`, transfers the approved amount to the refund requester, and then
   records `Processed`. It uses the reentrancy guard and cannot process an
   already resolved request.

Every rejected transition leaves the refund record unchanged. Contract pause
guards apply to the mutating operations. Reads (`get_refund`,
`get_refund_count`, and `get_reason_code_analytics`) are public.

## Analytics

`get_reason_code_analytics()` returns six sorted `(code, count)` pairs, including
zero-count buckets. It scans only the most recent 100 refund IDs, so the result
is a bounded recent-window report rather than an all-time total. Missing or
evicted records in that window are skipped. Consumers that need historical or
all-time reporting must persist the refund events/records in an indexer.

The application endpoint `GET /api/refunds?analytics=true` returns the same six
code buckets for the authenticated user. Its database query is user-scoped;
the on-chain contract query is contract-scoped and bounded as described above.

See [CONTRACT_FUNCTION_REFERENCE.md](CONTRACT_FUNCTION_REFERENCE.md#refunds)
for the callable signatures and [API_GUIDE.md](API_GUIDE.md) for API response
conventions.
