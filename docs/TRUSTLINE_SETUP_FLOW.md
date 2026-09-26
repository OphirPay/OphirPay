# Stellar Trustline Setup & Multi-Asset Receiving Flow

This document details the architecture, state machine, transaction generation, client UX, and simulation utilities for Stellar trustlines in OphirPay.

---

## 1. Overview & Problem

In the Stellar network, accounts cannot receive or hold non-native assets (such as USDC or custom issued tokens) without first establishing an explicit **trustline** to the asset's issuer.

Previously, attempting to send or receive a non-native asset on an account lacking a trustline resulted in low-level Horizon error codes (`op_no_trust`, `op_src_no_trust`). 

This implementation adds an end-to-end trustline setup flow:
- Explains trustlines in plain language:  
  > *"A trustline is an explicit agreement on the Stellar network that enables your account to receive and hold a specific non-native asset from an issuer."*
- Clarifies network reserve costs (**0.5 XLM base reserve** per trustline).
- Classifies and communicates four distinct trustline states with dedicated messaging.
- Generates verified, memo-free `change_trust` transactions ready for single-click wallet signing.
- Upgrades the `AssetSelector` and `Receive` pages to guide users seamlessly.
- Provides a deterministic `TrustlineSimulator` for local and unit testing without network dependencies.

---

## 2. Trustline States & Distinct Messaging

The status of an account's trustline for any given asset is classified into four distinct states:

| State | Condition | User-Facing Message | Action Required |
|---|---|---|---|
| `no_trustline` | Asset does not exist in `account.balances` | *"No trustline established. Your account must establish a trustline with the issuer before receiving {assetCode}."* | Yes (Establish Trustline) |
| `authorized` | `is_authorized: true` | *"Trustline active and authorized. Your account is ready to receive payments in {assetCode}."* | No (Ready to transact) |
| `unauthorized` | `is_authorized: false`, `is_authorized_to_maintain_liabilities: true` | *"Trustline unauthorized: The asset issuer requires explicit authorization before your account can receive or trade {assetCode}."* | Yes (Contact Issuer) |
| `frozen` | `is_authorized: false`, `is_authorized_to_maintain_liabilities: false` | *"Trustline frozen: The asset issuer has temporarily frozen this trustline for your account. You cannot receive payments until the issuer restores authorization."* | Yes (Contact Issuer) |

---

## 3. Base Reserve Requirement

On the Stellar network:
- Minimum balance reserve formula: `(2 + subentries) * 0.5 XLM`.
- Adding a trustline increments an account's subentry count by `1`.
- Therefore, creating a new trustline requires an additional **0.5 XLM** available in the account's unreserved balance.
- If the account lacks sufficient XLM, the transaction will fail with `op_low_reserve`.
- The UI proactively verifies this via `canAffordTrustlineReserve()` before prompting the user's wallet.

---

## 4. Transaction Generation & Memo-Free Guarantee

Trustline transactions invoke the `change_trust` operation (`Operation.changeTrust`).

### Memo-Free Design
Stellar best practices and compliance requirements stipulate that account configuration transactions such as trustline establishment should remain **memo-free** (`Memo.none()`). OphirPay's builders enforce this strictly:

```typescript
import { Operation, Asset, TransactionBuilder, Account } from "@stellar/stellar-sdk";

export function createChangeTrustTransaction(params: CreateChangeTrustParams): Transaction {
  const asset = new Asset(params.assetCode, params.assetIssuer);
  const operation = Operation.changeTrust({
    asset,
    ...(params.limit ? { limit: params.limit } : {}),
  });

  return new TransactionBuilder(params.account, {
    fee: params.fee ?? "100",
    networkPassphrase: params.networkPassphrase,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
  })
    .addOperation(operation)
    // Strictly memo-free: no .addMemo() call
    .build();
}
```

---

## 5. Trustline Simulator (`src/lib/trustline-simulator.ts`)

For local offline development and vitest suites, `TrustlineSimulator` reproduces Stellar Core's ledger behaviors in-memory:
- Account creation and balance initialization.
- Reserve requirement checks (`op_low_reserve` simulation when balance < reserve).
- Subentry tracking on `change_trust` creation and removal (`limit: "0"`).
- Issuer authorization flag manipulation (`freezeTrustline`, `authorizeTrustline`, `setUnauthorizedTrustline`).
- Full simulation of compiled Stellar `Transaction` objects via `simulateTransaction(tx)`.

---

## 6. User Interface Flows

### Asset Selector (`src/components/AssetSelector.tsx`)
- Inspects trustlines for non-native assets whenever an account is provided.
- Displays state badges in the selection menu (`✓ trustline`, `no trustline`, `frozen`, `unauthorized`).
- Automatically surfaces a prominent warning notice below the selector when an untrusted asset is chosen, complete with the one-sentence explanation, 0.5 XLM reserve note, and a "Set up trustline" button.

### Receive Page (`src/app/receive/page.tsx`)
- Integrated asset switcher (XLM, USDC, custom tokens).
- When a non-native asset without a trustline is chosen:
  - Displays the guided trustline establishment banner.
  - Senders cannot make payments until the user creates the trustline.
  - Clicking "Establish Trustline" invokes `establishTrustlineWithWallet()` to sign and submit the transaction via Freighter / Albedo / Lobstr / xBull.
  - Upon on-chain confirmation, the status updates immediately to `authorized`.
  - The SEP-7 QR code and payment URI automatically encode `asset_code` and `asset_issuer` (`web+stellar:pay?destination=G...&asset_code=USDC&asset_issuer=GBBD...`).

---

## 7. API Reference

### `GET /api/trustlines/check`
Query parameters:
- `account`: Destination Stellar public key (`G...`).
- `code`: Asset code (e.g. `USDC`).
- `issuer`: Asset issuer public key (`G...`).

Example response:
```json
{
  "success": true,
  "data": {
    "account": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "assetCode": "USDC",
    "assetIssuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    "hasTrustline": false,
    "status": "no_trustline",
    "explanation": "A trustline is an explicit agreement on the Stellar network that enables your account to receive and hold a specific non-native asset from an issuer.",
    "message": "No trustline established. Your account must establish a trustline with the issuer before receiving USDC.",
    "actionRequired": true,
    "reserveRequirementXlm": "0.5"
  }
}
```

---

## 8. Verification & Test Coverage

- **Unit tests**: `src/__tests__/trustline.test.ts`
  - Tests state classification, distinct messaging, reserve calculations, memo-free transaction builder correctness, Horizon mocked responses, and full simulator operations.
- **UI tests**: `src/__tests__/trustline-ui.test.tsx`
  - Tests `AssetSelector` trustline notices, setup actions, frozen/unauthorized warnings, and `ReceivePage` wallet submission and SEP-7 multi-asset URI formatting.
- **E2E tests**: `e2e/trustline-flow.spec.ts`
  - Tests receive page loading, disconnected prompts, parameter validation, and API responses.
