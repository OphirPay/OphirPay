# Payment Streams with Linear Vesting

## Overview

Payment Streams in OphirPay provide continuous, second-by-second linear token vesting directly on the Stellar Soroban smart contract. This enables automated trustless payouts for payroll, milestone grants, advisory vesting, and ongoing retainer agreements without intermediaries.

Tokens are locked in the `OphirPayContract` upon creation. As time elapses between `start_time` and `end_time`, tokens vest continuously according to Soroban's on-chain linear vesting curve.

---

## On-Chain Contract Architecture

The payment stream functionality is governed by Soroban smart contract functions in `contracts/ophirpay/src/lib.rs`:

```rust
pub struct Stream {
    pub id: u64,
    pub creator: Address,
    pub recipient: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub asset: Address,
    pub start_time: u64,
    pub end_time: u64,
    pub cancelled: bool,
    pub metadata: String,
}
```

### Core Operations

| Function | Authorization | Description |
| :--- | :--- | :--- |
| `create_stream` | `creator.require_auth()` | Transfers `total_amount` to contract, records stream, bumps TTL, and increments `LOCKED_BALANCE`. |
| `claim_stream` | `recipient.require_auth()` | Evaluates `compute_vested(now)`, transfers `claimable = vested - claimed_amount` to recipient, and updates `claimed_amount`. |
| `cancel_stream` | `creator.require_auth()` | Marks `cancelled = true`, refunds all `unvested = total_amount - vested` tokens to creator, leaving vested tokens for the recipient. |
| `get_stream` | Read-only simulation | Retrieves full on-chain stream metadata and claim progress. |
| `get_stream_count`| Read-only simulation | Returns the total count of streams initialized on-chain. |

---

## Mathematical Parity & Overflow Protection

The UI calculations strictly mirror the on-chain Rust implementation in `src/lib/streams.ts`:

### 1. Linear Vesting Calculation (`computeVested`)

```typescript
export function computeVested(
  totalAmount: bigint | number | string,
  startTime: number,
  endTime: number,
  nowSeconds: number
): bigint {
  const total = BigInt(totalAmount);
  if (total <= 0n) return 0n;
  if (nowSeconds >= endTime) return total;
  if (nowSeconds <= startTime) return 0n;

  const elapsed = BigInt(nowSeconds - startTime);
  const totalDuration = BigInt(endTime - startTime);
  if (totalDuration === 0n) return total;

  return (total * elapsed) / totalDuration;
}
```

### 2. Claimable Calculation (`computeClaimable`)

```typescript
export function computeClaimable(
  totalAmount: bigint | number | string,
  claimedAmount: bigint | number | string,
  startTime: number,
  endTime: number,
  nowSeconds: number,
  cancelled?: boolean
): bigint {
  if (cancelled) return 0n;
  const vested = computeVested(totalAmount, startTime, endTime, nowSeconds);
  const claimed = BigInt(claimedAmount);
  const claimable = vested - claimed;
  return claimable > 0n ? claimable : 0n;
}
```

### 3. Unvested Refund Calculation (`computeUnvested`)

```typescript
export function computeUnvested(
  totalAmount: bigint | number | string,
  startTime: number,
  endTime: number,
  nowSeconds: number
): bigint {
  const total = BigInt(totalAmount);
  const vested = computeVested(totalAmount, startTime, endTime, nowSeconds);
  const unvested = total - vested;
  return unvested > 0n ? unvested : 0n;
}
```

---

## UI Components & Views

### 1. Streams List View (`/streams`)
- **Metrics Summary**: Displays total stream count, active stream count, total volume (XLM), and the current connected wallet's claimable amount.
- **Filter Tabs**: `All Streams`, `Incoming (Recipient)`, `Outgoing (Creator)`, `Active`, `Completed`, `Cancelled`.
- **Search**: Instant client-side search by Stream ID, creator address, recipient address, or metadata memo.
- **Creation Dialog**: `CreateStreamModal` allows configuring recipient address, total XLM, duration presets (1 Hour, 1 Day, 1 Week, 30 Days, 90 Days, or custom hours), and purpose memos.

### 2. Stream Card (`StreamCard.tsx`)
- Displays live status badge (`ACTIVE`, `PENDING`, `COMPLETED`, `CANCELLED`).
- Displays role badges (`Creator`, `Recipient`, `Observer`) based on active wallet.
- Includes `VestingCurve` with live 1-second interval ticker.
- **Role-Gated Actions**:
  - **Recipient**: "Claim [X] XLM" button, enabled whenever `claimable > 0n` and stream is not cancelled.
  - **Creator**: "Cancel Stream" button, refunding unvested tokens.
  - **Observer**: Read-only display without privileged buttons.

### 3. Stream Detail View (`/streams/[id]`)
- Full page inspection with high-precision vesting progress bar.
- Financial statistics grid: Total Locked, Total Vested, Claimed, Remaining to Claim, and Unvested tokens.
- Interactive action cards for claim and cancellation.
- Complete on-chain contract details table with Stellar explorer links for creator and recipient accounts.

---

## Verification & Testing

1. **Unit Testing (`src/__tests__/stream-vesting.test.ts`)**:
   - Validates mathematical identity between TypeScript and Soroban Rust contracts.
   - Tests boundary conditions (`now < startTime`, `now == startTime`, midpoints, `now == endTime`, `now > endTime`).
   - Verifies overflow resistance for large numbers (10^19 stroops).
   - Validates `claimedAmount` subtractions and cancellation rules.

2. **Component & Role Gating Tests (`src/__tests__/streams-ui.test.tsx`)**:
   - Tests rendering of `VestingCurve` and `StreamCard`.
   - Tests recipient-only claim execution and creator-only cancellation.
   - Tests third-party observer restrictions.
   - Tests contract error surfacing in user-facing toasts and error banners.

3. **End-to-End Suite (`e2e/streams-flow.spec.ts`)**:
   - Exercises navigation to `/streams`, metric cards, modal form controls, and `/streams/[id]` detail curves.
