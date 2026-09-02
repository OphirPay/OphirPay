# 🧰 OphirPay Troubleshooting Guide

> Common setup and network errors — with **symptom → cause → fix** for each.
> If your issue isn't here, search the [issues](https://github.com/OphirPay/OphirPay/issues)
> and open a new one with the error message, your network (`TESTNET`/`PUBLIC`),
> and the commands you ran.

**Quick links:** [Setup & environment](#-setup--environment) · [Funding (friendbot)](#-funding--friendbot) · [RPC & network](#-rpc--network) · [Trustlines](#-trustlines) · [Wallet rejections](#-wallet-rejections) · [App runtime](#-app-runtime) · [Live events (SSE)](#-live-events-sse)

---

## 🔧 Setup & environment

### `npm install` fails or hangs

| | |
|---|---|
| **Symptom** | `npm install` errors out, or the install never finishes |
| **Cause** | Lockfile out of sync, registry/network issue, or a platform-specific dependency |
| **Fix** | 1. Delete `node_modules` and re-run `npm ci` (uses the committed lockfile): `rm -rf node_modules && npm ci`. 2. If you changed dependencies, run `npm install` and **commit the updated `package-lock.json`**. 3. Check `npm config get registry` is a reachable registry (default `https://registry.npmjs.org/`). |

### `Prisma generate failed` / `Schema not found`

| | |
|---|---|
| **Symptom** | `next build` or `npm run dev` fails at the Prisma step |
| **Cause** | Prisma client not generated, or wrong `DATABASE_PROVIDER` |
| **Fix** | Run `npx prisma generate`. Verify `DATABASE_PROVIDER` is set (`postgresql` for production, `sqlite` for local dev). Then re-run the build. |

### `ENOENT: no such file or directory, open '.env'` / `NEXT_PUBLIC_*` values missing

| | |
|---|---|
| **Symptom** | App starts but env-driven features are blank or error at runtime |
| **Cause** | No `.env.local` / `.env.production` file |
| **Fix** | `cp .env.example .env.local` and fill in the required values (see the [Deployment Guide](DEPLOYMENT.md#-environment-variables)). Restart the dev server — Next.js caches env at boot. |

### `AUTH_SECRET is not set` at login

| | |
|---|---|
| **Symptom** | Login/session endpoints fail with an auth error |
| **Cause** | Missing session-signing secret |
| **Fix** | Generate one and set it: `echo "AUTH_SECRET=$(openssl rand -hex 32)" >> .env.local`. Restart. |

### `next build` fails after switching branches

| | |
|---|---|
| **Symptom** | Build errors referencing stale code or missing modules |
| **Cause** | Stale `.next` cache or leftover `node_modules` from another branch |
| **Fix** | `rm -rf .next node_modules && npm ci && npm run build`. |

---

## 💰 Funding (friendbot)

### Friendbot returns an error or the account stays at 0 XLM

| | |
|---|---|
| **Symptom** | `friendbot.stellar.org` request fails, or the account balance stays 0 after funding |
| **Cause** | You requested funds for the **wrong network** (friendbot only funds **testnet**), the address is malformed, or the account already has funds (friendbot refuses duplicates) |
| **Fix** | 1. Only use friendbot on **testnet**: `curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"`. 2. Verify the address is a valid Stellar `G…` strkey (56 chars). 3. Check the balance via Horizon: `curl -s "https://horizon-testnet.stellar.org/accounts/<PUBLIC_KEY>" \| jq '.balances[] \| select(.asset_type=="native") \| .balance'`. 4. If it says the account already exists, it is funded — just poll Horizon until the balance appears. |

### `Insufficient funds` on testnet

| | |
|---|---|
| **Symptom** | Any transaction fails with `Insufficient funds` / `op_underfunded` |
| **Cause** | The signing account has no XLM; on **testnet** it wasn't friendbot-funded |
| **Fix** | Fund it (friendbot for testnet, exchange for mainnet — **there is no friendbot on mainnet**), then wait a few seconds for the ledger to confirm before retrying. |

### `Insufficient funds` on mainnet

| | |
|---|---|
| **Symptom** | Deployment or payment fails with insufficient funds |
| **Cause** | Mainnet accounts must be funded with **real XLM**; there is no friendbot |
| **Fix** | Send XLM from an exchange or funded wallet to the account, confirm the balance via `https://horizon.stellar.org/accounts/<PUBLIC_KEY>`, and budget ≥ 100 XLM for contract deployment (see the [Mainnet Runbook](MAINNET_RUNBOOK.md#01-funding)). |

---

## 🌐 RPC & network

### `failed to send HTTP request` / RPC timeout

| | |
|---|---|
| **Symptom** | API routes or the CLI hang, then fail with a request/connection error |
| **Cause** | Soroban RPC endpoint unreachable, wrong URL, or a firewall/proxy issue |
| **Fix** | 1. Verify the endpoint responds: `curl -s -X POST https://soroban-testnet.stellar.org:443 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`. 2. Check `NEXT_PUBLIC_STELLAR_RPC_URL` (testnet: `https://soroban-testnet.stellar.org:443`, mainnet: `https://soroban.stellar.org:443`). 3. Check [status.stellar.org](https://status.stellar.org) for an outage. 4. Retry — transient timeouts are normal; the app retries automatically. |

### `Horizon timeout` / Horizon requests fail

| | |
|---|---|
| **Symptom** | Account/balance lookups fail; the dashboard shows no balances |
| **Cause** | Horizon endpoint down, slow, or misconfigured |
| **Fix** | 1. Verify: `curl -s https://horizon-testnet.stellar.org/ | jq .core_version`. 2. Confirm `NEXT_PUBLIC_STELLAR_HORIZON_URL` matches the network. 3. Check status.stellar.org. 4. Try the alternate Horizon instance for your network. |

### `Network passphrase mismatch`

| | |
|---|---|
| **Symptom** | Transaction submission fails with a passphrase error |
| **Cause** | `STELLAR_NETWORK_PASSPHRASE` doesn't match the configured network |
| **Fix** | Testnet: `Test SDF Network ; September 2015`. Mainnet: `Public Global Stellar Network ; September 2015`. They must match `NEXT_PUBLIC_STELLAR_NETWORK` (`TESTNET`/`PUBLIC`) — see the [env table](DEPLOYMENT.md#testnet-vs-mainnet). |

### `Contract not found` / contract calls return empty

| | |
|---|---|
| **Symptom** | API routes that read the contract return nothing, or `Contract not found` |
| **Cause** | Wrong `NEXT_PUBLIC_CONTRACT_ID` / `NEXT_PUBLIC_EMITTER_CONTRACT_ID`, or the contract lives on a different network |
| **Fix** | 1. Verify the IDs in `.env.local` against the [contract registry](deployment-mainnet.md#26-contract-address-registry) (testnet IDs are pre-configured in `.env.example`). 2. Confirm the contract was deployed on the same network you're pointing at. |

---

## 🤝 Trustlines

### Non-native asset (e.g. USDC) can't be selected or sent

| | |
|---|---|
| **Symptom** | The asset is greyed out, or sending fails with a trustline error |
| **Cause** | The destination/your account has no **trustline** for that asset+issuer. OphirPay checks this via `checkTrustline` before selecting an asset |
| **Fix** | 1. Add a trustline for the asset in Freighter (Assets → Add asset, enter code + issuer). 2. Confirm it registered: check the account balances on Horizon and look for the asset's `asset_code`/`asset_issuer`. 3. Retry the payment. |

### `would exceed trustline limit` / payment over trustline cap

| | |
|---|---|
| **Symptom** | Sending an amount fails at the trustline limit |
| **Cause** | The receiving account's trustline limit is lower than the send amount |
| **Fix** | Have the recipient raise the trustline limit (Freighter lets you edit the limit), or reduce the amount. |

---

## 👛 Wallet rejections

### Freighter doesn't connect / "Freighter not found"

| | |
|---|---|
| **Symptom** | Wallet button does nothing, or "install Freighter" prompt |
| **Cause** | Freighter extension not installed, or not unlocked |
| **Fix** | 1. Install Freighter from the extension store. 2. Unlock it. 3. Refresh the page. 4. If it still fails, check the browser console for an `isConnected` error and retry. |

### Wallet says "wrong network"

| | |
|---|---|
| **Symptom** | Transaction rejected with a network error |
| **Cause** | Freighter is on a different network than the app (`TESTNET` vs `PUBLIC`) |
| **Fix** | Switch Freighter's network to match the app (`Testnet` for local/testnet, `Mainnet` for production) and retry. |

### Wallet shows "transaction rejected"

| | |
|---|---|
| **Symptom** | The wallet popup opens but the transaction is rejected |
| **Cause** | The user clicked "Reject", or the wallet auto-rejected (e.g. fee too high, or the account is a hardware wallet requiring confirmation) |
| **Fix** | 1. Retry and **approve** the transaction in the popup. 2. Check the fee estimate isn't above the wallet's threshold. 3. For hardware wallets, confirm the transaction on the device. |

### Transaction fails after approval (in `submitted` / `failed` state)

| | |
|---|---|
| **Symptom** | The wallet signs, but the payment errors on submission |
| **Cause** | Common causes: insufficient funds, invalid destination, missing memo for memo-required destination, or expired timebounds |
| **Fix** | 1. Confirm the payer has XLM to cover the amount + fee. 2. Confirm the destination `G…`/`C…` address is valid. 3. If the destination requires a memo, include one. 4. Retry — the app rebuilds the transaction. |

---

## ⚙️ App runtime

### `Rate limit exceeded` (HTTP 429)

| | |
|---|---|
| **Symptom** | API requests fail with 429 |
| **Cause** | Per-IP rate limit hit (`RATE_LIMIT_RPM`, default 120/min) |
| **Fix** | Wait for the window to reset. For sustained load, raise `RATE_LIMIT_RPM` or configure `REDIS_URL` for distributed limiting. |

### `CSRF_INVALID`

| | |
|---|---|
| **Symptom** | Form/API submissions fail with a CSRF error |
| **Cause** | Stale session cookie or `NEXT_PUBLIC_APP_URL` mismatch |
| **Fix** | Clear cookies and reload. Ensure `NEXT_PUBLIC_APP_URL` matches the origin you're using (localhost vs. domain). |

### Payments page is empty after sending a payment

| | |
|---|---|
| **Symptom** | The payment succeeded on-chain but doesn't appear in the UI |
| **Cause** | The page reads from the contract via RPC; a stale RPC response or wrong contract ID |
| **Fix** | 1. Verify on-chain: `stellar contract invoke --id <CONTRACT_ID> -- get_payment_count`. 2. Check the [contract registry](deployment-mainnet.md#26-contract-address-registry) for the right ID. 3. Refresh after a few seconds (the chain confirms asynchronously). |

---

## 📡 Live events (SSE)

### Live feed shows "offline" / events stop arriving

| | |
|---|---|
| **Symptom** | The `/events` page status flips to offline, or `payment:created` events stop |
| **Cause** | The SSE route (`GET /api/events`) is unreachable — often a reverse proxy that buffers the stream, or the emitter contract/RPC is down |
| **Fix** | 1. Verify the stream: `curl -N http://localhost:3000/api/events` — you should see a `connected` event then `heartbeat` frames every 15 s. 2. If behind Nginx, disable buffering (`proxy_buffering off;`) — see the [Nginx example](DEPLOYMENT.md#reverse-proxy-nginx). 3. Check the emitter contract ID and RPC health (see [RPC & network](#-rpc--network)). |

### `WebSocket connection failed` then falls back

| | |
|---|---|
| **Symptom** | Status shows `fallback` (SSE) instead of WS |
| **Cause** | The WebSocket event server (port `8787`, `EVENTS_WS_PORT`) isn't running or isn't reachable; the client falls back to SSE automatically |
| **Fix** | 1. This is **expected behavior** — SSE fallback works. 2. The WebSocket server starts automatically on boot via `instrumentation.ts` (`EVENTS_WS_PORT`, default `8787`); check the startup log for `WebSocket event server listening`. 3. Confirm `ws(s)://<host>:8787/api/events` connects. 4. In production, make sure the port is exposed through the ingress/load balancer. |

---

## Still stuck?

- Check [status.stellar.org](https://status.stellar.org) for network-wide issues.
- Search [docs/AUDIT.md](AUDIT.md), [docs/DEPLOYMENT.md](DEPLOYMENT.md), and the [Mainnet Runbook](MAINNET_RUNBOOK.md).
- Open an issue with: the **exact error message**, your **network** (`TESTNET`/`PUBLIC`), the **commands you ran**, and whether it reproduces locally.

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
