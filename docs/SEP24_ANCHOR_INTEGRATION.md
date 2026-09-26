# SEP-24 Anchor Integration (Fiat On & Off-Ramp)

This document specifies OphirPay's implementation of the Stellar Ecosystem Proposal 24 (**SEP-24: Hosted Deposit and Withdrawal**) and SEP-1 discovery.

---

## 1. Overview & Problem Solved

Users often think in fiat terms (USD, EUR) and need a reliable, compliant path to acquire XLM, USDC, or EURC on Stellar without leaving the application or manually searching for exchange services.

OphirPay integrates with licensed Stellar anchors using SEP-24, allowing users to:
1. Initiate an interactive deposit (buy crypto with credit card, ACH, bank wire, SEPA).
2. Initiate an interactive withdrawal (sell on-chain crypto and receive fiat in a bank account).
3. Undergo regulated identity verification (KYC/AML) directly inside the anchor's secure interface.
4. Automatically sync completed on-chain transactions into the user's OphirPay payment records.

---

## 2. Architecture & Lifecycle

```
┌──────────┐                 ┌──────────────┐                 ┌─────────────┐
│ OphirPay │                 │ OphirPay API │                 │ SEP-24      │
│  Client  │                 │    Server    │                 │   Anchor    │
└────┬─────┘                 └──────┬───────┘                 └──────┬──────┘
     │                              │                                │
     │ 1. GET /api/fiat/anchor      │                                │
     ├─────────────────────────────►│ 2. Fetch /.well-known/stellar.toml
     │                              ├───────────────────────────────►│
     │                              │ 3. Parse TRANSFER_SERVER_SEP24 │
     │                              │◄───────────────────────────────┤
     │◄─────────────────────────────┤                                │
     │                              │                                │
     │ 4. POST /api/fiat/initiate   │                                │
     ├─────────────────────────────►│ 5. POST /transactions/deposit/interactive
     │                              ├───────────────────────────────►│
     │                              │◄───────────────────────────────┤
     │◄─────────────────────────────┤ Returns interactive URL        │
     │                              │                                │
     │ 6. Open interactive URL      │                                │
     ├──────────────────────────────────────────────────────────────►│
     │    (Customer performs KYC & transfers bank funds)             │
     │                                                               │
     │ 7. Poll GET /api/fiat/transaction/:id                         │
     ├─────────────────────────────►│ 8. GET /transaction?id=...     │
     │                              ├───────────────────────────────►│
     │                              │◄───────────────────────────────┤
     │                              │ 9. Status == "completed"       │
     │                              │    Record in DB payment ledger │
     │◄─────────────────────────────┤                                │
```

---

## 3. Dynamic Discovery (SEP-1)

Rather than hardcoding anchor API endpoints, OphirPay dynamically resolves configuration from the anchor's domain using SEP-1:

1. Query `https://<ANCHOR_DOMAIN>/.well-known/stellar.toml`.
2. Extract:
   - `TRANSFER_SERVER_SEP0024`: Base URL for interactive operations.
   - `WEB_AUTH_ENDPOINT`: SEP-10 challenge authentication server (optional).
   - `SIGNING_KEY`: Anchor Stellar master account.
   - `[[CURRENCIES]]`: Supported on-chain assets.
3. Query `<TRANSFER_SERVER_SEP0024>/info` to obtain minimum/maximum deposit amounts and fee schedules.
4. Cache discovered configuration in memory with a 5-minute TTL.

---

## 4. Status Polling & State Transition

SEP-24 transactions transition through defined states:

| Status | Phase | Description | Action Required |
|---|---|---|---|
| `incomplete` | Setup | Session created; awaiting user input in anchor window. | User interacts with anchor |
| `pending_user_transfer_start` | Awaiting Transfer | Anchor is waiting for external bank or wire transfer. | User sends wire / card |
| `pending_anchor` | Anchor Processing | Anchor received fiat and is validating KYC/AML. | Background wait |
| `pending_stellar` | Stellar Network | Anchor is submitting on-chain Stellar transaction. | Monitoring mempool |
| `completed` | Finished | On-chain funds confirmed and released to destination account. | Sync to OphirPay ledger |
| `error` / `expired` | Failed | Transaction failed or timed out. | Display failure diagnostic |

When a transaction enters the `completed` state:
- The `stellar_transaction_id` is recorded.
- A new payment record is created or updated in the OphirPay database with status `COMPLETED`.
- The user's dashboard and payment histories immediately display the new funds.

---

## 5. 🛡️ Regulatory Compliance & KYC Boundary

> [!IMPORTANT]
> **Strict Non-Custodial Architecture**
>
> 1. **No Fiat Custody:** OphirPay is open-source software and **never** takes custody of fiat currencies, bank deposits, credit card numbers, or off-chain cash equivalents.
> 2. **KYC Responsibility:** Customer Due Diligence (CDD), Know Your Customer (KYC), and Anti-Money Laundering (AML) sanctions checks are performed **exclusively by the third-party anchor** within their hosted interactive window.
> 3. **Data Privacy:** Personal identity documents, Social Security numbers, government IDs, and banking credentials are never passed through or stored by OphirPay servers.
> 4. **Licensed Entities:** Anchor partners (e.g., Kado, MoonPay, Bitso, MoneyGram) are independent, licensed money transmitters or financial institutions responsible for compliance with their respective local jurisdictions.

---

## 6. Environment Configuration

Add the following variables to `.env.local` or deployment environments:

```ini
# Configurable Stellar anchor domain (default: testnet.kado.sh)
ANCHOR_DOMAIN=testnet.kado.sh
NEXT_PUBLIC_ANCHOR_DOMAIN=testnet.kado.sh

# Set to true only in development/testing to allow HTTP mock servers
ANCHOR_ALLOW_HTTP=false
```
