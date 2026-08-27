# 📊 Database Schema

> Entity-Relationship Diagram (ERD) of the OphirPay Prisma schema. This documents all models, their fields, and relationships.

---

## Entity-Relationship Diagram

```mermaid
erDiagram
    User ||--o{ Account : owns
    User ||--o{ Payment : creates
    User ||--o{ Batch : owns
    User ||--o{ Recurrence : owns
    User ||--o{ PaymentRequest : creates
    User ||--o{ Webhook : configures
    User ||--o{ ApiKey : creates
    User ||--o{ Refund : requests
    User ||--o{ NotificationHook : registers

    Account ||--o{ Payment : "source of"
    Account ||--o{ Payment : "destinations for"

    Batch ||--o{ Payment : contains
    Recurrence ||--o{ Payment : generates
    Payment ||--o{ Refund : may have

    User {
        string id PK "cuid"
        string stellarAddress UK "Stellar public key (G...)"
        string name "Display name"
        string email UK "Email address"
        string avatarUrl "Profile image URL"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    Account {
        string id PK "cuid"
        string userId FK "→ User"
        string publicKey UK "Stellar public key (G...)"
        string name "Account label"
        boolean isActive "Default: true"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    Payment {
        string id PK "cuid"
        string userId FK "→ User"
        decimal amount "Decimal(18,7)"
        string assetCode "Default: XLM"
        string assetIssuer "Issuer for non-native assets"
        string description "Human-readable note"
        string memo "Stellar memo (max 28 bytes)"
        PaymentStatus status "Default: CREATED"
        string transactionHash "Stellar tx hash"
        string stellarOpId "Stellar operation ID"
        string sourceAccountId FK "→ Account (nullable)"
        string destAccountId FK "→ Account (nullable)"
        string batchId FK "→ Batch (nullable)"
        string recurrenceId FK "→ Recurrence (nullable)"
        string metadata "JSON string"
        string errorMessage "On failure"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
        datetime completedAt "When status=COMPLETED"
        datetime deletedAt "Soft delete"
    }

    Batch {
        string id PK "cuid"
        string userId FK "→ User"
        string name "Batch label"
        string description "Optional description"
        BatchStatus status "Default: CREATED"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    Recurrence {
        string id PK "cuid"
        string userId FK "→ User"
        string name "Schedule label"
        Frequency frequency "DAILY|WEEKLY|BIWEEKLY|MONTHLY|QUARTERLY|YEARLY"
        decimal amount "Decimal(18,7)"
        string assetCode "Default: XLM"
        string assetIssuer "Issuer for non-native assets"
        string destAddress "Stellar destination address"
        string description "Optional note"
        boolean isActive "Default: true"
        datetime nextRunAt "Next scheduled execution"
        datetime lastRunAt "Last execution time"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    PaymentRequest {
        string id PK "cuid"
        string userId FK "→ User"
        decimal amount "Decimal(18,7)"
        string assetCode "Default: XLM"
        string assetIssuer "Issuer for non-native assets"
        string description "Invoice description"
        string recipientAddress "Stellar address"
        RequestStatus status "Default: PENDING"
        string transactionHash "Stellar tx hash when paid"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    Webhook {
        string id PK "cuid"
        string userId FK "→ User"
        string url "Delivery endpoint"
        string events "JSON array of event types"
        boolean isActive "Default: true"
        string secret "HMAC-SHA256 signing key"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    ApiKey {
        string id PK "cuid"
        string userId FK "→ User"
        string name "Key label"
        string keyHash UK "SHA-256 hash of the key"
        string prefix "First 8 chars for display"
        datetime lastUsed "Last usage timestamp"
        datetime createdAt "Auto-set on create"
        datetime expiresAt "Optional expiration"
    }

    Refund {
        string id PK "cuid"
        string userId FK "→ User"
        string paymentId FK "→ Payment (nullable)"
        decimal amount "Decimal(18,7)"
        string asset "Default: native"
        string reason "Human-readable reason"
        int reasonCode "Numeric reason code"
        RefundStatus status "Default: REQUESTED"
        int onChainId UK "On-chain Soroban refund ID"
        datetime requestedAt "When refund was requested"
        datetime resolvedAt "When refund was resolved"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }

    NotificationHook {
        string id PK "cuid"
        string userId FK "→ User"
        string eventType "Event to listen for"
        string webhookUrl "Delivery endpoint"
        boolean active "Default: true"
        int onChainId UK "On-chain Soroban hook ID"
        datetime createdAt "Auto-set on create"
        datetime updatedAt "Auto-updated"
    }
```

---

## Enums

### PaymentStatus

| Value | Description |
|---|---|
| `CREATED` | Initial state — payment record created, not yet signed |
| `SIGNED` | Transaction signed by wallet, awaiting submission |
| `SUBMITTED` | Submitted to Stellar network, awaiting confirmation |
| `CONFIRMED` | Confirmed on-chain, awaiting final processing |
| `PENDING` | Awaiting manual approval (multisig) |
| `PROCESSING` | Actively being processed |
| `COMPLETED` | Successfully completed |
| `FAILED` | Failed — check `errorMessage` for details |
| `CANCELLED` | Cancelled by user or system |

### BatchStatus

| Value | Description |
|---|---|
| `CREATED` | Batch created, payments not yet processed |
| `PROCESSING` | Payments being processed in sequence |
| `COMPLETED` | All payments completed successfully |
| `PARTIALLY_COMPLETED` | Some payments succeeded, some failed |
| `FAILED` | Batch processing failed |

### Frequency

| Value | Description |
|---|---|
| `DAILY` | Every day |
| `WEEKLY` | Once per week |
| `BIWEEKLY` | Every two weeks |
| `MONTHLY` | Once per month |
| `QUARTERLY` | Every 3 months |
| `YEARLY` | Once per year |

### RequestStatus

| Value | Description |
|---|---|
| `PENDING` | Awaiting payment |
| `PAID` | Payment received |
| `EXPIRED` | Request expired before payment |
| `CANCELLED` | Cancelled by creator |

### RefundStatus

| Value | Description |
|---|---|
| `REQUESTED` | Refund requested, awaiting approval |
| `APPROVED` | Refund approved, awaiting processing |
| `REJECTED` | Refund rejected |
| `PROCESSED` | Refund processed on-chain |

---

## Key Relationships

| Relationship | Type | Description |
|---|---|---|
| User → Account | 1:N | A user owns multiple Stellar accounts |
| User → Payment | 1:N | A user creates multiple payments |
| User → Batch | 1:N | A user owns multiple batch groups |
| User → Recurrence | 1:N | A user has multiple recurring schedules |
| User → PaymentRequest | 1:N | A user creates multiple payment requests |
| User → Webhook | 1:N | A user configures multiple webhooks |
| User → ApiKey | 1:N | A user creates multiple API keys |
| User → Refund | 1:N | A user requests multiple refunds |
| User → NotificationHook | 1:N | A user registers multiple notification hooks |
| Account → Payment (source) | 1:N | An account is the source of multiple payments |
| Account → Payment (dest) | 1:N | An account is the destination of multiple payments |
| Batch → Payment | 1:N | A batch contains multiple payments |
| Recurrence → Payment | 1:N | A recurrence schedule generates multiple payments |
| Payment → Refund | 1:N | A payment may have multiple refund requests |

---

## Database Providers

OphirPay supports two database providers, switchable via the `DATABASE_PROVIDER` environment variable:

| Provider | Use Case | Connection |
|---|---|---|
| **SQLite** | Local development | `file:./dev.db` |
| **PostgreSQL** | Production (Neon, Supabase, RDS) | Connection string with pooling |

### Provider-specific notes

- **SQLite**: Used for local development with `npx prisma db push`. No migrations needed.
- **PostgreSQL**: Used in production with `npx prisma migrate deploy`. Supports connection pooling via `DIRECT_DATABASE_URL`.

---

## Generating the ERD

To regenerate this diagram from the Prisma schema:

```bash
# Option 1: Use prisma-erd-generator (generates SVG/PNG)
npx prisma-erd-generator --output docs/SCHEMA_ERD.svg

# Option 2: Use Mermaid CLI (renders the markdown diagram above)
npx @mermaid-js/mermaid-cli -i docs/SCHEMA.md -o docs/SCHEMA_ERD.svg

# Option 3: Use Prisma Studio (interactive GUI)
npx prisma studio
```

> The Mermaid diagram above is the source of truth. It's rendered automatically by GitHub, GitLab, and most markdown viewers without any build step.

---

## Indexes

The schema defines the following indexes for query performance:

| Model | Indexed Fields | Purpose |
|---|---|---|
| Account | `userId` | Fast lookup of accounts per user |
| Payment | `userId`, `status`, `batchId`, `recurrenceId`, `sourceAccountId`, `destAccountId` | Filter by user, status, batch, recurrence, or account |
| Batch | `userId`, `status` | Filter by user or status |
| Recurrence | `userId`, `nextRunAt` | Scheduler query for next execution |
| PaymentRequest | `userId` | Fast lookup per user |
| Webhook | `userId` | Fast lookup per user |
| Refund | `userId`, `status`, `paymentId` | Filter by user, status, or parent payment |
| NotificationHook | `userId`, `eventType` | Filter by user or event type |
| ApiKey | `userId`, `prefix` | Fast lookup by user or key prefix |

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
