# Recurring Payments

OphirPay supports **recurring payment schedules**: automated payments that
fire on a fixed interval (daily, weekly, biweekly, monthly, quarterly, or
yearly). Each run generates a `Payment` row that is then submitted and
reconciled like any other payment.

## Data model

`Recurrence` (see `prisma/schema.prisma`):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | cuid | |
| `userId` | string | owning user |
| `name` | string | human-readable label |
| `frequency` | enum | `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `QUARTERLY`, `YEARLY` |
| `amount` | Decimal(18,7) | must be > 0 |
| `assetCode` | string | defaults to `XLM` |
| `assetIssuer` | string? | for non-native assets |
| `destAddress` | string | Stellar recipient public key |
| `description` | string? | optional note |
| `isActive` | boolean | `false` means paused/cancelled |
| `nextRunAt` | DateTime | when the next run is due |
| `lastRunAt` | DateTime? | when the last run executed |

## API

### `GET /api/recurring`

List the authenticated user's recurring payments, newest first. Paginated
(`page`, `limit`). Amounts are serialized as strings.

### `POST /api/recurring`

Create a recurring payment schedule.

```json
{
  "name": "Monthly Rent",
  "frequency": "MONTHLY",
  "amount": 100,
  "assetCode": "XLM",
  "destAddress": "G...",
  "description": "Apartment rent",
  "sourceAccountId": "user_account_id"
}
```

The route computes `nextRunAt` from the current time and the chosen
frequency.

### `GET /api/recurring/<id>`

Return a single recurrence owned by the authenticated user. Amount is
serialized as a string.

### `PATCH /api/recurring/<id>`

Edit a recurring payment before it executes. Only active (`isActive: true`)
schedules can be edited. Any subset of the following fields may be provided;
omitted fields keep their current values.

```json
{
  "name": "Updated label",
  "amount": 150,
  "assetCode": "USDC",
  "assetIssuer": "G...",
  "destAddress": "G...",
  "description": "Updated note",
  "frequency": "WEEKLY",
  "nextRunAt": "2026-09-10T00:00:00.000Z"
}
```

Validation errors (400): `amount` must be greater than 0; `destAddress`
must be a valid Stellar address; `nextRunAt` must be a valid ISO 8601
datetime.

### `DELETE /api/recurring/<id>`

Cancel a recurring payment before it executes by setting `isActive` to
`false`. Already-cancelled schedules cannot be cancelled again.

Both `PATCH` and `DELETE` require a valid CSRF token and authentication.

## UI

`/recurring` lists all schedules and provides **Edit** and **Cancel**
actions for active schedules. Edited values are reflected immediately in
the list after a successful `PATCH`.

## Tests

- `src/__tests__/api-routes/recurring-refunds.test.ts` — route-level tests
  for GET, PATCH edit, and DELETE cancel, including auth/CSRF/ownership
  paths.
- `src/__tests__/recurring-scheduler.test.ts` — scheduler at-most-once
  claim logic.

## Future work

The Soroban contract now exposes `update_recurring` to edit an on-chain
recurring record (amount, next execution time, remaining count, and
metadata). Once the app layer persists the on-chain recurring ID alongside
the `Recurrence` row, `PATCH` / `DELETE` can be extended to keep the
contract state in sync.
