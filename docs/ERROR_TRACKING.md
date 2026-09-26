# Error Tracking & Ingestion Architecture

OphirPay provides an end-to-end error tracking and reporting pipeline that aggregates client and server exceptions, sanitizes sensitive blockchain data and personally identifiable information (PII), deduplicates recurring crashes, and makes error reports queryable.

---

## 1. Overview

```
 ┌──────────────────────┐        ┌──────────────────────┐
 │ <ErrorBoundary />    │        │ useErrorTracker()    │
 └──────────┬───────────┘        └──────────┬───────────┘
            │                               │
            └───────────────┬───────────────┘
                            ▼
               ┌─────────────────────────┐
               │    src/lib/sentry.ts    │
               │  - PII Scrubbing        │
               │  - Release & Segment    │
               │  - Deduplication        │
               └────────────┬────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
 ┌─────────────────────┐        ┌─────────────────────┐
 │ First-Party API     │        │ Sentry / External   │
 │   /api/errors       │        │ (when DSN is set)   │
 │ (queryable reports) │        │ (graceful no-op)    │
 └─────────────────────┘        └─────────────────────┘
```

---

## 2. Configuration & Graceful Degradation

Error tracking is configured via standard environment variables:

| Environment Variable | Description | Default / Fallback |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry ingestion DSN for browser & server reporting | Unset (degrades to first-party logging & `/api/errors`) |
| `SENTRY_DSN` | Server-only Sentry DSN | Unset |
| `NEXT_PUBLIC_RELEASE` | Application release tag attached to all error reports | `0.1.0` or package version |
| `SENTRY_UPLOAD_SOURCE_MAPS` | Enable browser source maps for Sentry symbolication | `false` |

### Unset DSN Behavior (Logging-Only Mode)
When `NEXT_PUBLIC_SENTRY_DSN` is unset, the system:
1. **Never crashes or throws**: no external network calls fail or block execution.
2. **Logs structured output**: writes sanitized error details to `console.error` (dev) or structured logger (production).
3. **Persists to first-party store**: records the deduplicated report in the in-memory ring buffer accessible via `/api/errors`.

---

## 3. PII Scrubbing & Redaction Rules

Financial applications handle sensitive credentials and ledger data. By default, OphirPay enforces strict PII scrubbing:

### Always Redacted (Cannot be opted in)
- **Stellar Secret Keys**: Pattern `S[A-Z0-9]{55}` is replaced with `[REDACTED_SECRET]`.
- **API Keys & Authorization**: Header tokens, bearer strings, and keys (`apiKey`, `password`, `token`) are replaced with `[REDACTED]`.
- **Email Addresses**: Replaced with `[REDACTED_EMAIL]`.

### Default-Redacted (Permitted only with `optInPii: true`)
- **Stellar Public Addresses**: Pattern `G[A-Z0-9]{55}` is replaced with `[REDACTED_ADDRESS]` unless the caller explicitly sets `optInPii: true`.
- **Token Amounts & Balances**: Numeric token quantities (e.g. `100.5 XLM`, `5000 USDC`, `1000 stroops`) or fields named `amount` / `balance` are replaced with `[REDACTED_AMOUNT]`.
- **Transaction Memos**: Memos that may contain user personal notes or references are replaced with `[REDACTED_MEMO]`.

---

## 4. Deduplication & Report Schema

Each error report is deduplicated using a deterministic fingerprint:
```
fingerprint = sha256(`${name}:${message}:${component}:${release}`)
```

If an error matching an existing fingerprint arrives, its `count` is incremented and `lastSeen` timestamp updated rather than generating duplicate entries.

### Report Shape (`ErrorReport`)
```typescript
interface ErrorReport {
  id: string;               // Unique report identifier (e.g. "err_1727192800000_abc123")
  fingerprint: string;      // Deterministic fingerprint hash for deduplication
  name: string;             // Error name (e.g. "TypeError", "RenderError")
  message: string;          // Scrubbed error message
  stack?: string;           // Scrubbed call stack
  component: string;        // Component where error occurred (e.g. "SendPaymentForm")
  segment: string;          // URL pathname or subsystem segment
  release: string;          // Release version (e.g. "0.1.0")
  environment: string;      // "development", "production", "test"
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string };   // Scrubbed user/anonymous identifier
  count: number;            // Number of occurrences observed
  firstSeen: string;        // ISO 8601 timestamp
  lastSeen: string;         // ISO 8601 timestamp
}
```

---

## 5. Usage in Components & Hooks

### In Error Boundaries (`<ErrorBoundary />`)
```tsx
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function PaymentsPage() {
  return (
    <ErrorBoundary componentName="PaymentsPage">
      <PaymentList />
    </ErrorBoundary>
  );
}
```

### In Event Handlers (`useErrorTracker`)
```tsx
import { useErrorTracker } from "@/hooks/useErrorTracker";

export function SubmitButton() {
  const { trackError } = useErrorTracker("SubmitButton", { segment: "/send" });

  const handleClick = async () => {
    try {
      await submitTransaction();
    } catch (err) {
      trackError(err as Error, { attempt: 1 });
    }
  };

  return <button onClick={handleClick}>Submit</button>;
}
```

---

## 6. Querying Reports via API

### List or Filter Reports
```http
GET /api/errors?release=0.1.0&component=PaymentsPage&limit=25
```
Response:
```json
{
  "success": true,
  "data": {
    "reports": [
      {
        "id": "err_1727192800000_abc123",
        "fingerprint": "err_4a89f2",
        "name": "Error",
        "message": "Payment failed for recipient [REDACTED_ADDRESS]",
        "component": "PaymentsPage",
        "segment": "/send",
        "release": "0.1.0",
        "count": 3,
        "firstSeen": "2026-09-24T15:00:00.000Z",
        "lastSeen": "2026-09-24T15:10:00.000Z"
      }
    ],
    "total": 1
  }
}
```

### Ingest a Report Directly
```http
POST /api/errors
Content-Type: application/json

{
  "name": "ChunkLoadError",
  "message": "Loading chunk 42 failed",
  "component": "DynamicPage",
  "segment": "/batches"
}
```
