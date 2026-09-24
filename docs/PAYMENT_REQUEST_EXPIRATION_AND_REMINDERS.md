# Payment Request Expiration & Reminders

## Overview
Payment requests provide shareable invoice-style payment links (`/pay/[address]`, `web+stellar:pay`, and `/api/requests`). Previously, payment requests lacked automated time-based lifecycle transitions and proactive reminders, causing expired or overdue requests to linger silently as outstanding.

Issue #810 introduces:
1. **Automated Expiration & Overdue State Transitions**: Requests past their due date (`dueDate`) or expiration (`expiresAt`) are transitioned to `OVERDUE` or `EXPIRED`.
2. **Exactly-Once Event Delivery**: Overdue and paid transitions dispatch webhook events (`request.overdue`, `request.expired`, `request.paid`) and in-app notifications exactly once, guaranteed by atomic database update predicates (`overdueNotifiedAt`, `paidNotifiedAt`).
3. **Rate-Limited Reminders**: Requesters can dispatch reminders to payers. Reminders are recorded with `reminderCount`, enforce a cooldown period (default 1 hour), and respect a hard cap (maximum 5 reminders).
4. **Visually Distinct Overdue Styling**: Overdue requests feature amber warnings and clear badges on the request management dashboard and the public invoice page.

---

## Data Model & Lifecycle

### Schema Additions (`PaymentRequest`)
```prisma
model PaymentRequest {
  id                String        @id @default(cuid())
  userId            String
  amount            Decimal       @db.Decimal(18, 7)
  assetCode         String        @default("XLM")
  assetIssuer       String?
  description       String?
  recipientAddress  String?
  status            RequestStatus @default(PENDING)
  dueDate           DateTime?
  expiresAt         DateTime?
  reminderCount     Int           @default(0)
  lastReminderAt    DateTime?
  overdueNotifiedAt DateTime?
  paidNotifiedAt    DateTime?
  transactionHash   String?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
}

enum RequestStatus {
  PENDING
  PAID
  EXPIRED
  OVERDUE
  CANCELLED
}
```

---

## State Transition Rules

| Initial Status | Condition | New Status | Webhook Event | Notification |
|---|---|---|---|---|
| `PENDING` | Current time >= `dueDate` | `OVERDUE` | `request.overdue` | `requestOverdue` |
| `PENDING` | Current time >= `expiresAt` | `EXPIRED` | `request.expired` | `requestOverdue` |
| Any (non-`PAID`) | On-chain payment confirmed | `PAID` | `request.paid` | `requestPaid` |
| `PENDING` / `OVERDUE` | Requester triggers reminder | No change (`reminderCount++`) | `request.reminder_sent` | `requestReminder` |

---

## API Endpoints

### 1. `POST /api/requests`
Creates a payment request with optional `dueDate` and `expiresAt`.

### 2. `POST /api/requests/[id]/remind`
Dispatches a reminder to the payer.
- Checks authentication and request ownership.
- Enforces minimum cooldown between reminders (1 hour) and maximum reminder limit (5).
- Returns `429 Too Many Requests` with remaining cooldown time if rate limited.
- Increments `reminderCount` and dispatches `request.reminder_sent`.

### 3. `POST /api/requests/[id]/pay`
Records an on-chain transaction hash for a payment request.
- Transitions status to `PAID`.
- Emits `request.paid` webhook event and notification exactly once.

### 4. `GET /api/cron/requests-expiry` & `POST /api/cron/requests-expiry`
Scheduled transition endpoint for external schedulers or Vercel/GitHub Actions cron.
- Authorizes via `x-cron-secret` or `Authorization: Bearer <CRON_SECRET>`.
- Executes `transitionOverduePaymentRequests(now)`.
