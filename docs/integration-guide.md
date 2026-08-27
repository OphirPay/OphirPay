# OphirPay Integration Guide

This guide helps developers integrate OphirPay's payment infrastructure into their own applications.

## Quick Start

### 1. Install Dependencies

```bash
git clone https://github.com/OphirPay/OphirPay.git
cd OphirPay
npm install
npx prisma generate
cp .env.example .env.local
# Edit .env.local with your configuration
npm run dev
```

### 2. Deploy Contracts (Testnet)

```bash
# Build and deploy both contracts
./scripts/deploy-all.sh <YOUR_TESTNET_SECRET_KEY>

# The script outputs contract IDs. Copy them to .env.local
NEXT_PUBLIC_CONTRACT_ID=...
NEXT_PUBLIC_EMITTER_CONTRACT_ID=...
```

### 3. Initialize Contracts

```bash
# Using the Stellar CLI:
stellar contract invoke \
  --id $NEXT_PUBLIC_CONTRACT_ID \
  --source <SECRET_KEY> \
  --network testnet \
  -- init --owner <YOUR_PUBLIC_KEY>

# Link Emitter for cross-contract orchestration:
stellar contract invoke \
  --id $NEXT_PUBLIC_CONTRACT_ID \
  --source <SECRET_KEY> \
  --network testnet \
  -- set_emitter --caller <YOUR_PUBLIC_KEY> --emitter $NEXT_PUBLIC_EMITTER_CONTRACT_ID
```

## Integration Patterns

### Pattern 1: Record a Payment

```typescript
import { recordPayment } from "@/lib/contract-advanced";

const result = await recordPayment(
  payerPublicKey,
  payeePublicKey,
  amountInStroops,
  assetAddress, // "native" for XLM
  transactionHash,
  "Payment for services"
);

if (result.success) {
  console.log("Payment recorded:", result.txHash);
}
```

### Pattern 2: Create an Escrow

```typescript
const escrowId = await contract.create_escrow({
  depositor: payerKey,
  beneficiary: recipientKey,
  arbiter: null, // optional third-party dispute resolver
  amount: 10000000n, // in stroops
  asset: "native",
  deadline: Math.floor(Date.now() / 1000) + 86400, // 24h from now
  metadata: "Security deposit for apartment #42"
});
```

### Pattern 3: Listen to Events (SSE)

```typescript
const eventSource = new EventSource("/api/events");

eventSource.onmessage = (event) => {
  const payment = JSON.parse(event.data);
  console.log("New payment:", payment);
  // Update UI, trigger webhook, etc.
};
```

### Pattern 4: Register a Webhook

```typescript
import { registerHook } from "@/lib/contract-advanced";

await registerHook(
  subscriberPublicKey,
  "payment_recorded",          // event type to subscribe to
  "https://my-server.com/hooks" // your webhook endpoint
);
```

Your endpoint receives HMAC-SHA256 signed payloads:

```http
POST /hooks HTTP/1.1
Content-Type: application/json
X-OphirPay-Signature: <hmac-sha256 hex>
X-OphirPay-Event: payment_recorded

{
  "event": "payment_recorded",
  "timestamp": "2026-08-06T12:00:00Z",
  "data": { "paymentId": 42, "amount": "10000000" },
  "signature": "<hmac-sha256 hex>"
}
```

The signature is HMAC-SHA256 (hex) over the payload **without** the
`signature` field, using the secret returned when you registered the
webhook. The same value is mirrored in the `X-OphirPay-Signature` header for
convenience. Verify by recomputing:

```typescript
import { createHmac, timingSafeEqual } from "crypto";

const received = await request.json();
const { signature, ...payload } = received; // strip signature before signing
const expected = createHmac("sha256", yourSecret)
  .update(JSON.stringify(payload))
  .digest("hex");
const ok = signature.length === expected.length &&
  timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
```

Always compare with a constant-time comparison (`timingSafeEqual`) and
reject requests missing a valid signature.

### Webhook Event Types

Payments emit lifecycle events as they progress through their lifecycle:

| Event | Fired when |
|---|---|
| `payment.created` | A payment record is created |
| `payment.signed` | The payment transaction has been signed |
| `payment.submitted` | The signed transaction has been submitted to the network |
| `payment.confirmed` | The submitted transaction has been confirmed on-chain |
| `payment.completed` | The payment is fully settled/completed |
| `payment.failed` | The payment failed |

Batches, recurrences, and payment requests emit their own events
(`batch.*`, `recurrence.*`, `request.*`). Subscribe to any subset of these
event types when registering a webhook.

## Available Contract Functions

### Payments
| Function | Description |
|---|---|
| `record_payment` | Record an off-chain payment on the Soroban ledger |
| `get_payment` | Get a payment by ID |
| `get_payment_count` | Total payment count |
| `cancel_payment` | Cancel a payment record (owner only) |
| `atomic_spend` | Validate spending limit THEN record payment atomically |

### Escrows
| Function | Description |
|---|---|
| `create_escrow` | Lock tokens with deadline, optional arbiter |
| `release_escrow` | Owner releases to beneficiary |
| `claim_escrow` | Beneficiary claims after deadline |
| `get_escrow` | Get escrow by ID |

### Refunds
| Function | Description |
|---|---|
| `request_refund` | Request a refund with reason code |
| `approve_refund` | Owner approves refund |
| `process_refund` | Execute refund (transfers tokens back) |
| `get_refund` | Get refund by ID |
| `get_reason_code_analytics` | Count refunds grouped by reason code |

### Multisig
| Function | Description |
|---|---|
| `set_multisig_config` | Configure N-of-M signers |
| `propose_payment` | Propose a payment needing approval |
| `approve_payment` | Signer approves a proposal |
| `execute_approved_payment` | Execute after threshold met |

### Governance
| Function | Description |
|---|---|
| `configure_governance` | Set voting parameters |
| `create_proposal` | Create a DAO proposal |
| `vote_on_proposal` | Vote yes/no with weight |
| `execute_proposal` | Execute after voting ends |

### Admin
| Function | Description |
|---|---|
| `pause` / `unpause` | Circuit breaker |
| `emergency_pause_all` | Pause both OphirPay + Emitter atomically |
| `transfer_ownership` | Two-step transfer with 24h timelock |
| `accept_ownership` | Accept pending ownership |
| `set_fee_config` | Configure platform fees per operation |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Yes | Soroban RPC endpoint |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Yes | Horizon API endpoint |
| `NEXT_PUBLIC_CONTRACT_ID` | Yes | OphirPay contract address |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | Yes | Emitter contract address |
| `NEXT_PUBLIC_DEMO_MODE` | No | Enable simulated TXs without real funds |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `HOOK_SECRET` | No | Webhook HMAC signing secret |

## Testing

```bash
# Frontend tests (834)
npm test

# Contract tests
cd contracts/ophirpay && cargo test
cd contracts/emitter && cargo test

# E2E tests (71)
npx playwright test
```

## Need Help?

- [Open an issue](https://github.com/OphirPay/OphirPay/issues/new?template=bug_report.yml)
- [Read the architecture guide](./architecture.md)
- [View the mainnet deployment guide](./deployment-mainnet.md)
- [Check SUPPORT.md](../.github/SUPPORT.md)
