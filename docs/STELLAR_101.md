# 🌟 How Stellar Payments Work

> A concise primer for web developers new to blockchain. This covers the concepts you need to understand OphirPay's architecture and start building on Stellar.

---

## Table of Contents

- [TL;DR](#tldr)
- [Accounts](#accounts)
- [XLM — Stellar's Native Currency](#xlm--stellars-native-currency)
- [Operations](#operations)
- [Transactions](#transactions)
- [Signatures & Signing](#signatures--signing)
- [Memos](#memos)
- [Testnet & Friendbot](#testnet--friendbot)
- [Friendbot FAQ & Faucets](#friendbot-faq--faucets)
- [Horizon — Stellar's REST API](#horizon--stellars-rest-api)
- [Soroban — Smart Contracts on Stellar](#soroban--smart-contracts-on-stellar)
- [Minimal Working Example: Send XLM](#minimal-working-example-send-xlm)
- [Wallet Connectors & Ledger Status](#wallet-connectors--ledger-status)
- [Glossary](../GLOSSARY.md)
- [Further Reading](#further-reading)

---

## TL;DR

Stellar is a **fast, low-cost blockchain** designed for payments. Unlike Ethereum, Stellar uses a **Consensus Protocol** (not proof-of-work), so transactions settle in ~5 seconds with fees under $0.01. If you're a web developer, think of Stellar as a **payment rail** with a REST API — you don't need to write Solidity or manage gas auctions.

| Concept            | Stellar Equivalent                       |
| ------------------ | ---------------------------------------- |
| Wallet address     | Stellar public key (`G...`)              |
| Private key        | Secret key (`S...`) — signs transactions |
| Native currency    | XLM (Lumens)                             |
| Smart contracts    | Soroban (Rust-based)                     |
| Block explorer API | Horizon (REST)                           |
| Test environment   | Testnet + Friendbot (free XLM)           |

---

## Accounts

A Stellar account is identified by a **public key** — a 56-character string starting with `G`. This is like an email address: you share it to receive payments.

```
Public key:  GABCD...XYZ1234567890abcdefghij (56 chars, starts with G)
Secret key:  SABC...XYZ1234567890abcdefghijkl (56 chars, starts with S)
```

**Key points:**

- The **public key** (`G...`) is safe to share — it's your "address"
- The **secret key** (`S...`) is private — it controls the account. **Never share it.**
- Accounts don't have "balances" in the traditional sense — they have **trustlines** for each asset they hold
- Every account must hold a minimum **base reserve** of 1 XLM (currently 0.5 XLM base + 0.5 XLM per additional entry)

**How to create an account:**

- On **testnet**: Use Friendbot (free, instant)
- On **mainnet**: Another account must create it by sending ≥1 XLM to the new public key

---

## XLM — Stellar's Native Currency

**XLM (Lumens)** is Stellar's native cryptocurrency, used for:

- Paying **transaction fees** (fractions of a cent)
- Satisfying **base reserve** requirements (1 XLM minimum per account)
- **Bridge asset** for cross-asset payments (EUR → XLM → USD)
- Paying for **Soroban contract** storage rent

XLM is analogous to ETH on Ethereum, but with near-zero fees and ~5-second settlement.

| Property      | Value                               |
| ------------- | ----------------------------------- |
| Unit          | 1 XLM = 10,000,000 stroops          |
| Smallest unit | 1 stroop (0.0000001 XLM)            |
| Typical fee   | ~0.00001 XLM (~$0.000001)           |
| Supply        | ~50 billion XLM (inflation removed) |

---

## Operations

An **operation** is the atomic unit of work on Stellar. Each transaction can contain **up to 100 operations** bundled together.

Common operation types:

| Operation                          | What it does                       | Example                              |
| ---------------------------------- | ---------------------------------- | ------------------------------------ |
| `payment`                          | Send XLM or a custom asset         | Send 10 USDC to Alice                |
| `create_account`                   | Fund a new account                 | Create Bob's account with 1 XLM      |
| `manage_data`                      | Store key-value data on-chain      | Set `invoice_id: "INV-001"`          |
| `change_trust`                     | Create/modify a trustline          | Trust USDC issuer for 1000 max       |
| `path_payment`                     | Swap assets via built-in DEX       | Pay EUR, receiver gets USD           |
| `set_options`                      | Configure account (multisig, etc.) | Set 2-of-3 multisig threshold        |
| `begin_sponsoring_future_reserves` | Sponsor another account's reserves | Company pays employee's base reserve |

**Think of operations like API endpoints:** each one does one specific thing.

---

## Transactions

A **transaction** is a container for one or more operations. It's what gets submitted to the network and included in a ledger.

```
Transaction
├── Source account: GABCD...
├── Fee: 0.00001 XLM
├── Sequence number: 12345 (prevents replay)
├── Operations:
│   ├── [0] payment → send 10 XLM to Bob
│   └── [1] manage_data → set key="status", value="active"
├── Memo: "Invoice #1234"
├── Signatures: [sig_from_sender]
└── Valid after: now
    Valid before: now + 300 seconds
```

**Key concepts:**

- **Sequence number**: Each account has an incrementing counter. Transaction N must use sequence N+1. This prevents replay attacks.
- **Fee**: Paid by the source account, even if the transaction fails
- **Time bounds**: Optional validity window (default: 300 seconds)
- **Max fee**: You set a cap; the network charges the actual fee

**Settlement:** Once submitted, a transaction is validated by the Stellar Consensus Protocol and included in a **ledger** (a block) within ~5 seconds.

---

## Signatures & Signing

Every transaction must be **signed** by the source account's secret key. This proves you authorized the payment.

```
Transaction (unsigned)
    ↓
Sign with secret key (S...)
    ↓
Transaction (signed)
    ↓
Submit to Horizon API
    ↓
Included in ledger
```

**Multisig:** Stellar supports **multi-signature** accounts. You can require N-of-M signatures before a transaction is valid:

| Threshold | Example                                     |
| --------- | ------------------------------------------- |
| 1-of-1    | Default — single signer                     |
| 2-of-3    | Company treasury — 2 directors must approve |
| 3-of-5    | DAO governance — 3 council members          |

OphirPay uses multisig for payment approvals and admin actions.

**How signing works in practice:**

1. Build the transaction (specify operations, fee, memo)
2. Sign it locally with your secret key (never sent to a server)
3. Submit the signed transaction to Horizon
4. Horizon validates and forwards to the network

---

## Memos

A **memo** is an optional text field attached to a transaction (up to 28 bytes for `MEMO_TEXT`, or 32 bytes for `MEMO_HASH`).

```javascript
// Attach a memo to a payment
const transaction = new TransactionBuilder(account, { fee })
  .addOperation(
    Operation.payment({
      destination: "GBOY...",
      asset: Asset.native(),
      amount: "10.0",
    })
  )
  .addMemo(Memo.text("Invoice #1234")) // ← memo
  .setTimeout(300)
  .build();
```

**Use cases:**

- Link payments to invoices: `"INV-2024-001"`
- Tag payments for accounting: `"Q3 Revenue"`
- Reference external systems: `" order_id:abc123"`

Memos are **not** encrypted and are visible on-chain. Don't put sensitive data in them.

---

## Testnet & Friendbot

Stellar operates two networks:

| Network     | Purpose                   | Passphrase                                       |
| ----------- | ------------------------- | ------------------------------------------------ |
| **Testnet** | Development & testing     | `Test SDF Network ; September 2015`              |
| **Public**  | Real money, real payments | `Public Global Stellar Network ; September 2015` |

**Friendbot** is a free service that creates and funds testnet accounts:

```bash
# Fund a testnet account with 10,000 XLM (free!)
curl "https://friendbot.stellar.org?addr=GABCD...YOUR_PUBLIC_KEY"
```

Or in JavaScript:

```javascript
const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
const data = await response.json();
console.log("Account funded:", data);
```

**⚠️ Important:** Testnet XLM has no real value. Never send testnet tokens to mainnet addresses or vice versa.

**OphirPay default:** The app runs on testnet. Switch to mainnet by changing `NEXT_PUBLIC_STELLAR_NETWORK="PUBLIC"` in your `.env`.

---

## Friendbot FAQ & Faucets

Faucet problems are the most common "the app is broken" false alarm on
testnet. Friendbot is a shared, rate-limited service — a `429` means you are
queued, not blocked.

### Why does Friendbot return `429 Too Many Requests`?

`friendbot.stellar.org` enforces a **per-IP throttle of roughly one request
every 10 seconds**. The limit is shared by everything behind your IP — your
browser, the OphirPay dev server, wallet extensions, and any scripts — so a
quick reload loop, several browser tabs, or a CI job running in parallel can
exhaust it. The throttle is per _source IP_, not per account, so funding five
fresh addresses one after another too quickly trips it even though each
address is new.

| Response                | Meaning                                                                                         | What to do                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `200 OK`                | Account created and funded with 10,000 testnet XLM                                              | Nothing — you're done                                   |
| `400 Bad Request`       | Address is invalid, or the account already exists (Friendbot does not top up existing accounts) | Fix the key, or fund from another account (below)       |
| `429 Too Many Requests` | Per-IP throttle is active                                                                       | Wait ~10 s and retry with backoff; see the script below |
| `5xx`                   | Friendbot is temporarily unavailable                                                            | Treat like `429`: back off, or use a fallback faucet    |

> Friendbot failures never affect real funds — testnet XLM has no value.
> Never point these commands at a mainnet address.

### Fallback faucets and options

1. **Wait and retry (cheapest).** Sleep ~10 seconds between requests. The
   `scripts/testnet-integration.mjs` helper already retries with backoff when
   it funds its throwaway accounts.
2. **Stellar Laboratory.** Use the graphical
   [account creator](https://laboratory.stellar.org/#account-creator?network=test)
   (`Create account` → Testnet). It calls the same faucet, so the same throttle
   applies — but it retries for you in the UI.
3. **Local Friendbot via Stellar Quickstart.** Run a standalone container with
   its own Friendbot on port `8000` and sidestep the public throttle entirely —
   ideal for offline development, demos, and CI. See
   [Local Stellar Quickstart Standalone](LOCAL_DEV.md#13-local-stellar-quickstart-standalone-container-offline-testing--development).
   ```bash
   # Local faucet endpoint once the quickstart container is healthy
   curl "http://localhost:8000/friendbot?addr=GABCD...YOUR_PUBLIC_KEY"
   ```
4. **Fund from an account you already control.** Any funded testnet account can
   create and fund a new one with a single `create_account` operation. The new
   account needs no faucet at all:
   ```bash
   stellar tx new create-account \
     --source-account <FUNDED_SECRET_OR_KEY_NAME> \
     --destination GABCD...NEW_PUBLIC_KEY \
     --starting-balance 100 \
     --network testnet
   ```
   This is the most reliable option on a throttled IP: one funded keypair can
   seed any number of fresh accounts, and the operation costs only the base fee
   and the new account's reserve.
5. **OphirPay's in-app button.** When the connected Freighter account has no
   balance, the app offers a "fund via Friendbot" action that performs the same
   `GET /friendbot?addr=` call for you.

### Create custom test assets (no external faucet needed)

Friendbot only issues XLM. For USDC-like test tokens, issue your own asset on
testnet — the whole flow is three CLI calls with the
[Stellar CLI](https://developers.stellar.org/docs/tools/cli):

```bash
# 1. Create a keypair for the issuer (stored locally by the CLI)
stellar keys generate my-issuer --network testnet --fund

# 2. Create a second keypair for the holder, then fund it from the issuer
stellar keys generate my-holder --network testnet --fund

# 3. Add a trustline to the asset, then issue tokens to the holder
stellar tx new change-trust \
  --source-account my-holder \
  --line "USDC:$(stellar keys address my-issuer)" \
  --network testnet

stellar tx new payment \
  --source-account my-issuer \
  --destination "$(stellar keys address my-holder)" \
  --asset "USDC:$(stellar keys address my-issuer)" \
  --amount 1000 \
  --network testnet
```

The holder now has a balance of `1000 USDC`. To hand the tokens to other
test accounts, they each add the same trustline first (step 3); anyone can then
be funded with `stellar tx new payment` from the issuer. Everything above is
**testnet only** — see [Horizon](#horizon--stellars-rest-api) for verifying
balances.

### Fund many accounts sequentially (bash/zsh)

Friendbot's 10-second throttle is per IP, so parallel funding is pointless —
run the requests one at a time with a gap, and back off on `429`. This script
works unmodified in **bash** and **zsh**, validates the keys before calling the
network, and exits non-zero if any account could not be funded:

```bash
#!/usr/bin/env bash
# fund-testnet.sh — fund one or more Stellar testnet accounts via Friendbot.
# Usage: ./fund-testnet.sh G... [G... ...]
#   FRIENDBOT  override the faucet URL (e.g. http://localhost:8000/friendbot)
#   THROTTLE   seconds to sleep between requests (default 10)
set -u

FRIENDBOT="${FRIENDBOT:-https://friendbot.stellar.org}"
THROTTLE="${THROTTLE:-10}"
MAX_RETRIES="${MAX_RETRIES:-5}"
TMP_BODY=$(mktemp 2>/dev/null || echo "/tmp/fund-testnet.$$")

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <G...public-key> [<G...public-key> ...]" >&2
  exit 2
fi

failed=0
for key in "$@"; do
  case "$key" in
    G??????*) ;;
    *) echo "SKIP $key: not a G... public key" >&2; failed=1; continue ;;
  esac

  attempt=1
  while :; do
    code=$(curl -sS --max-time 30 -o "$TMP_BODY" -w '%{http_code}' \
      "$FRIENDBOT?addr=$key" 2>/dev/null) || code=000

    case "$code" in
      200)
        echo "OK    $key funded"
        break
        ;;
      400)
        echo "INFO  $key already funded or rejected (HTTP 400)"
        break
        ;;
      429)
        if [ "$attempt" -ge "$MAX_RETRIES" ]; then
          echo "FAIL  $key still rate-limited after $attempt attempts" >&2
          failed=1
          break
        fi
        wait=$((THROTTLE * attempt))
        echo "WAIT  $key rate-limited; retry $attempt in ${wait}s"
        sleep "$wait"
        attempt=$((attempt + 1))
        ;;
      *)
        echo "FAIL  $key: HTTP $code (is Friendbot reachable?)" >&2
        failed=1
        break
        ;;
    esac
  done

  sleep "$THROTTLE" # keep the next request under the per-IP throttle
done

rm -f "$TMP_BODY"
exit "$failed"
```

```bash
chmod +x fund-testnet.sh
./fund-testnet.sh GABC...KEY1 GABC...KEY2 GABC...KEY3

# Against a local quickstart container (no public throttle):
FRIENDBOT=http://localhost:8000/friendbot THROTTLE=1 ./fund-testnet.sh GABC...KEY1
```

> **Why not parallel?** Every request comes from the same IP, so `curl ... &`
> plus `wait` does not go faster — it produces a burst of `429`s, and requests
> that fail mid-burst still count against your next window. Sequential +
> backoff is the only pattern that reliably succeeds.

---

## Horizon — Stellar's REST API

**Horizon** is Stellar's HTTP API server — think of it as the "backend" for reading blockchain data. OphirPay uses Horizon to:

- Query account balances
- Fetch transaction history
- Submit signed transactions
- Stream events in real time

| Endpoint                          | What it returns                       |
| --------------------------------- | ------------------------------------- |
| `GET /accounts/{id}`              | Account details, balances, trustlines |
| `GET /accounts/{id}/transactions` | Transaction history                   |
| `GET /transactions/{hash}`        | Single transaction details            |
| `GET /transactions?op=...`        | Transactions by operation             |
| `POST /transactions`              | Submit a signed transaction           |
| `GET /effects`                    | Real-time effect streaming            |

**Base URLs:**

- Testnet: `https://horizon-testnet.stellar.org`
- Public: `https://horizon.stellar.org`

**Example — Check an account balance:**

```bash
curl https://horizon-testnet.stellar.org/accounts/GABCD...YOUR_KEY
```

Response:

```json
{
  "balances": [
    { "asset_type": "native", "balance": "100.0000000" },
    { "asset_type": "credit_alphanum4", "asset_code": "USDC", "balance": "50.0000000" }
  ]
}
```

---

## Soroban — Smart Contracts on Stellar

**Soroban** is Stellar's smart contract platform, launched in 2024. Contracts are written in **Rust** and compiled to WASM.

| Feature         | Soroban                        | Ethereum Solidity     |
| --------------- | ------------------------------ | --------------------- |
| Language        | Rust                           | Solidity              |
| Compilation     | WASM                           | EVM bytecode          |
| Execution model | Separate execution environment | In-transaction        |
| Cost model      | Predictable (rent-based)       | Gas auction           |
| Storage         | Persistent + temporary         | Permanent (expensive) |

**How OphirPay uses Soroban:**

- `OphirPayContract` — handles payment recording, multisig, governance, RBAC
- `PaymentEventEmitter` — stores payment events for SSE streaming
- Cross-contract calls for emergency pause/unpause orchestration

**Key Soroban concepts:**

- **Contract instance**: A deployed contract with an address
- **Ledger entries**: Persistent key-value storage on-chain
- **Host functions**: Built-in functions (crypto, storage, events)
- **Invocations**: Calling a contract function with arguments

You don't need to write Soroban contracts to use OphirPay — the contracts are already deployed on testnet. But understanding them helps if you want to extend the platform.

---

## Minimal Working Example: Send XLM

Here's a complete, working example that sends 10 XLM on testnet:

```javascript
import { Keypair, Server, TransactionBuilder, Operation, Asset, Networks, Memo } from "stellar-sdk";

// 1. Connect to Horizon testnet
const server = new Server("https://horizon-testnet.stellar.org");

// 2. Your keypair (get one from https://laboratory.stellar.org/#account-creator?network=test)
const sourceKeypair = Keypair.fromSecret("S...YOUR_SECRET_KEY");
const sourcePublicKey = sourceKeypair.publicKey();

// 3. Destination (can be any testnet account)
const destination = "GBOY...DESTINATION_PUBLIC_KEY";

// 4. Load the source account from the network
const account = await server.loadAccount(sourcePublicKey);

// 5. Build the transaction
const transaction = new TransactionBuilder(account, {
  fee: await server.fetchBaseFee(),
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    Operation.payment({
      destination,
      asset: Asset.native(), // XLM
      amount: "10.0", // 10 XLM
    })
  )
  .addMemo(Memo.text("Hello from OphirPay!"))
  .setTimeout(300) // 5-minute timeout
  .build();

// 6. Sign with your secret key
transaction.sign(sourceKeypair);

// 7. Submit to the network
try {
  const result = await server.submitTransaction(transaction);
  console.log("✅ Transaction successful!");
  console.log("Ledger:", result.ledger);
  console.log("Hash:", result.hash);
} catch (error) {
  console.error("❌ Transaction failed:", error.response?.data || error);
}
```

**What happens:**

1. Your account loads from Horizon (current sequence number, balance)
2. A transaction is built with one `payment` operation
3. You sign it locally (secret key never leaves your machine)
4. Horizon validates and submits to the Stellar network
5. Within ~5 seconds, the transaction is confirmed on-chain

---

## Wallet Connectors & Ledger Status

OphirPay ships one unified connector per wallet. All six registry entries can
connect and sign, including Ledger hardware wallets.

| Wallet    | Type                     | Status       |
| --------- | ------------------------ | ------------ |
| Freighter | Browser extension        | ✅ Supported |
| xBull     | Browser extension        | ✅ Supported |
| Rabet     | Browser extension        | ✅ Supported |
| Albedo    | Web-based (no extension) | ✅ Supported |
| Lobstr    | Web-based (SEP-7)        | ✅ Supported |
| Ledger    | Hardware (WebUSB)        | ✅ Supported |

### Ledger browser and device requirements

- **WebUSB** is required, and only **Chromium-based** browsers implement it:
  Chrome, Edge, Brave and Opera. Firefox and Safari cannot talk to a Ledger
  from a web page at all.
- The page must be served over **HTTPS** (or `localhost`) — WebUSB is a
  secure-context API.
- The device must be connected over USB with the **Stellar app open**.
- The browser prompts for permission to access the device; a denied prompt has
  to be reset in the browser's USB settings before retrying.
- OphirPay derives the account at `44'/148'/0'`. The public key is confirmed
  on the device at connect time; transaction signatures are produced locally
  by the Stellar app and added to the transaction envelope in the browser.

Ledger is available alongside **Freighter, xBull, Rabet, Albedo and Lobstr** in
the wallet selector. If WebUSB is unavailable, use one of those connectors.

---

| Term                   | Definition                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| **Account**            | A Stellar address identified by a public key (`G...`)                 |
| **Asset**              | Anything that can be sent on Stellar: XLM, USDC, custom tokens        |
| **Base reserve**       | Minimum XLM an account must hold (currently 0.5 XLM base)             |
| **Consensus Protocol** | Stellar's agreement mechanism (SCP) — replaces mining                 |
| **Dex**                | Decentralized exchange built into Stellar — swap assets natively      |
| **Envelope**           | A transaction wrapper containing signatures and metadata              |
| **Friendbot**          | Testnet service that creates and funds accounts for free              |
| **Horizon**            | Stellar's REST API for reading and submitting transactions            |
| **Ledger**             | A "block" on Stellar — contains transactions, occurs every ~5 seconds |
| **Lumen (XLM)**        | Stellar's native cryptocurrency                                       |
| **Memo**               | Optional text attached to a transaction (up to 28 bytes)              |
| **Multisig**           | Requiring N-of-M signatures for a transaction to be valid             |
| **Operation**          | The atomic unit of work within a transaction (up to 100 per tx)       |
| **Sequence number**    | Per-account counter that prevents transaction replay                  |
| **SEP**                | Stellar Ecosystem Proposal — standards for interoperability           |
| **Soroban**            | Stellar's smart contract platform (Rust → WASM)                       |
| **Stroop**             | Smallest unit of XLM: 1 XLM = 10,000,000 stroops                      |
| **Trustline**          | An account's permission to hold a non-native asset                    |
| **Tx**                 | Abbreviation for transaction                                          |

---

## Further Reading

| Resource                               | Link                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Stellar Developer Docs                 | [developers.stellar.org](https://developers.stellar.org)                       |
| Stellar Laboratory (visual TX builder) | [laboratory.stellar.org](https://laboratory.stellar.org)                       |
| Soroban Docs                           | [soroban.stellar.org](https://soroban.stellar.org)                             |
| Stellar Expert (block explorer)        | [stellar.expert](https://stellar.expert)                                       |
| Stellar SDK (JavaScript)               | [github.com/stellar/js-stellar-sdk](https://github.com/stellar/js-stellar-sdk) |
| OphirPay Source Code                   | [github.com/OphirPay/OphirPay](https://github.com/OphirPay/OphirPay)           |

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
