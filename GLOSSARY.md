# Stellar & Soroban Glossary

A quick reference for contributors who are new to Stellar and Soroban. Terms
are grouped loosely by topic, and each entry notes where the term shows up in
this codebase. If you hit a word you don't recognize while reading the code,
it should be here — if it isn't, please add it!

---

## Assets & units

| Term | Definition |
|------|-----------|
| **Lumen (XLM)** | The native asset of the Stellar network. "XLM" is the ticker; "lumen" is the name. Used for transaction fees, account reserves, and as the default payment asset in OphirPay (`assetCode: "XLM"`). |
| **Stroop** | The smallest unit of a lumen: 1 XLM = 10,000,000 stroops (1 stroop = 1e-7 XLM). OphirPay's Soroban contract path represents amounts as integer stroops and converts them via `XLM_STROOPS` in `src/lib/stellar.ts`; its Horizon payment builders instead pass decimal XLM strings to the Stellar SDK. Amounts are formatted with `formatAmount()` in `src/lib/utils.ts`. |
| **Native asset** | XLM itself, referred to as `"native"` in some payloads (e.g. `Refund.asset` defaults to `"native"`). |
| **Issued asset** | Any non-native asset on Stellar (e.g. USDC), identified by its **asset code** + **issuer** account. OphirPay models this with `assetCode` + `assetIssuer` fields. |

## Network & infrastructure

| Term | Definition |
|------|-----------|
| **Testnet** | The free Stellar network for development. Accounts are funded with fake XLM from the **friendbot**. OphirPay's default environment (see `STELLAR_NETWORK` / `NETWORK_PASSPHRASE` in `src/lib/stellar.ts`). |
| **Futurenet** | An experimental Stellar network for testing upcoming protocol features — not for production, and not guaranteed to be stable. |
| **Mainnet (Public network)** | The live Stellar network where real funds move. Requires real XLM and production RPC/Horizon endpoints. |
| **Friendbot** | A Stellar service that funds testnet accounts with free fake XLM (`friendbot` endpoint). Useful for onboarding new developers. |
| **Horizon** | Stellar's REST API server for reading ledger data and submitting transactions. OphirPay wraps it via `getHorizonServer()` in `src/lib/stellar.ts`. |
| **Soroban RPC** | The JSON-RPC endpoint for Soroban smart-contract interactions — `simulateTransaction`, `sendTransaction`, `getTransaction`, `getContractData`, etc. OphirPay's active runtime wrapper is `getSorobanServer()` in `src/lib/stellar.ts`, used by the contract reads/writes in `src/lib/contracts.ts`. |
| **Ledger** | A closed block of the Stellar chain. Accounts, balances, and contract state are all derived from ledger entries. Each transaction references the ledger sequence it lands in. |
| **Sequence number** | A per-account counter that increments with every transaction. Every transaction must specify the source account's current sequence number; this prevents replay of old transactions. |
| **Network passphrase** | A string identifying the network ("Test SDF Network ; September 2015" for testnet, "Public Global Stellar Network ; September 2015" for mainnet). Used when signing transaction envelopes. See `NETWORK_PASSPHRASE` in `src/lib/stellar.ts`. |
| **XDR** | External Data Representation — the binary format Stellar uses for transactions and ledger data. The JavaScript SDK produces/parses XDR strings; OphirPay builds transaction XDR with `buildPaymentTx` / `buildBatchPaymentTx` and submits it with `submitSignedTx`. |

## Accounts & keys

| Term | Definition |
|------|-----------|
| **Stellar address / public key** | A 56-character string starting with `G` (e.g. `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`). The on-chain identifier for an account. OphirPay validates these with the `stellarAddress` Zod schema (`^G[A-Z0-9]{55}$`). |
| **Keypair** | A public key + secret key pair. The public key is the address; the secret key signs transactions. Never commit secret keys — OphirPay stores API keys as hashes (`ApiKey.keyHash`) and wallet secrets stay in the wallet. |
| **Freighter** | The Stellar browser wallet extension (like MetaMask for Stellar). It holds keys and signs transactions. OphirPay integrates with it via `@stellar/freighter-api` in `src/hooks/useFreighter.tsx`. |
| **Memo** | An optional 28-byte field attached to a payment (e.g. an order ID or reference). Useful for reconciliation. OphirPay validates `memo` length ≤ 28 in its schemas and displays memos on payments. |
| **Trustline** | An account-level record that says "I accept this issued asset." You must hold a trustline for an asset before receiving it. OphirPay's trustline tooling lives in `src/lib/trustline.ts`. |
| **Sponsored reserves / sponsorship** | A mechanism where one account pays the minimum-balance reserve for another account (or for that account's trustlines/data entries), enabling "no-balance" onboarding. Relevant when an app creates accounts or trustlines on behalf of users. |
| **Reserve** | The minimum XLM balance an account must hold (currently 1 XLM for a basic account, plus 0.5 XLM per additional trustline/data entry). Transactions that would drop an account below its reserve fail. |

## Soroban (smart contracts)

| Term | Definition |
|------|-----------|
| **Soroban** | Stellar's smart-contract platform (Rust compiled to WASM). OphirPay's contracts live in `contracts/` (e.g. `contracts/ophirpay`, `contracts/emitter`). |
| **WASM** | WebAssembly — the compiled format Soroban contracts are deployed in. CI enforces a 128 KB WASM size limit per contract. |
| **SAC (Stellar Asset Contract)** | The built-in contract that wraps a Stellar asset, giving issued assets a token interface (balance, transfer, etc.). Soroban contracts interact with assets through the SAC. |
| **Contract invocation** | Calling a function on a deployed contract. Reads use `simulateContractCall`; writes build, sign, and submit a transaction via `invokeContractFunction` + `submitContractInvocation` (see `src/lib/contracts.ts`). |
| **Simulation (`simulateTransaction`)** | Running a contract call against a copy of current state to learn its effects (and the fee) without submitting anything. OphirPay reads on-chain data this way (`fetchOnChainPayments`, contract reads in `src/lib/contracts.ts`). |
| **Emitter contract** | A helper contract that emits events OphirPay subscribes to for real-time payment notifications (`contracts/emitter`). The `/api/events` SSE route polls the emitter contract directly via Soroban simulation. |
| **Contract ID** | The address of a deployed contract instance (starts with `C`). Configured via `NEXT_PUBLIC_CONTRACT_ID` / `NEXT_PUBLIC_EMITTER_CONTRACT_ID`. |
| **Contract data (`getContractData`)** | Reading a key-value entry directly from a contract's storage. OphirPay enumerates on-chain payments, escrows, streams, and proposals by invoking contract getter functions through transaction simulation instead (e.g. `fetchOnChainPayments` in `src/lib/contracts.ts`). |

## Payments & flows

| Term | Definition |
|------|-----------|
| **Path payment** | A payment that converts through intermediate assets (e.g. send XLM, deliver USDC). Two flavors on Stellar: **Strict Send** (PathPaymentStrictSend) and **Strict Receive** (PathPaymentStrictReceive). OphirPay's payment flows currently send XLM directly; path payments matter when supporting issued assets. |
| **Batch payment** | Submitting several payments in one transaction (or one contract call). OphirPay's `Batch` model + `/api/batches` endpoints implement this; the UI builds a single multi-op transaction via `buildBatchPaymentTx`. |
| **Transaction envelope** | The signed, ready-to-submit transaction (source account, sequence, operations, timebounds, signatures, fee). Built with the SDK, signed in the wallet, submitted to Horizon/RPC. |
| **Timebounds** | The `minTime`/`maxTime` window during which a transaction is valid. Often left open-ended; used by timelocked actions. |
| **Escrow** | Funds held by a third party (here: a Soroban contract) until conditions are met. See the `Escrow`-related code in `src/app/api/escrows/` and `src/lib/contract-advanced.ts`. |
| **Payment stream** | A schedule of small, regular payments (e.g. per-second salary streaming) executed by the contract. See `src/app/api/streams/`. |
| **Multisig** | Requiring multiple signatures to authorize an action. On Stellar this is modeled with signer weights + a threshold on the account; OphirPay's multisig UI/API wraps this (see `src/app/api/multisig/`). |
| **SEP** | Stellar Ecosystem Proposal — the standards documents that define interoperable protocols (e.g. SEP-10 for web authentication, SEP-24 for anchor deposits/withdrawals). OphirPay's wallet auth flow is SEP-inspired: sign a challenge to prove key ownership. |

## OphirPay-specific

| Term | Definition |
|------|-----------|
| **Webhook** | An outbound HTTP callback OphirPay sends when an event occurs. Payloads are signed with an HMAC-SHA256 secret (`signWebhookPayload` in `src/lib/webhook-deliver.ts`) so receivers can verify authenticity. |
| **On-chain ID (`onChainId`)** | A contract-returned `u64` id used by refunds and notification hooks to link a DB ledger row to its on-chain Soroban record (see `Refund.onChainId` / `NotificationHook.onChainId`). |
| **CUID** | The ID format Prisma generates for DB primary keys (`@default(cuid())`) — collision-resistant, URL-safe strings. |
