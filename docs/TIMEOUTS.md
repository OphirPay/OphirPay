# ⏱️ Outbound Request Timeouts

> Every outbound call OphirPay makes to a third party carries an explicit,
> configurable timeout **and** an `AbortSignal`. A slow upstream therefore
> surfaces as a classified, renderable error instead of a hung request that
> blows the serverless request budget and returns a bare `504`.

This document is the reference for issue **#747** (timeout audit).

## The helper — `src/lib/timeout.ts`

| Export | Purpose |
|---|---|
| `TimeoutError` | Classified error (`code: "TIMEOUT"`, `name: "TimeoutError"`) carrying `timeoutMs` and the operation `label`. |
| `isTimeoutError(err)` | True for our `TimeoutError`, a DOM `AbortError` raised by a timeout, or an SDK message like `timeout of 10000ms exceeded`. |
| `withAbortableTimeout(op, opts)` | Runs `op(signal)` with a controller that aborts when the budget elapses; throws `TimeoutError` on expiry and links any caller-supplied signal. |
| `fetchWithTimeout(input, init, opts)` | `fetch` + explicit timeout + `AbortSignal`. Use for every raw outbound HTTP call. |
| `withStellarTimeout(promise, opts)` | Races an SDK promise (whose client can't take a signal) against the budget and classifies the expiry. |
| `withStellarTimeoutProxy(server, ms, label)` | Wraps a Horizon/Soroban `Server` so **every** method — and fluent call builder `.call()` — is timeout-enforced. |
| `withTimeout(promise, ms, msg)` | The original fire-and-forget race, kept for backwards compatibility. |

## Where timeouts are applied

| Call path | Mechanism |
|---|---|
| Horizon (`getHorizonServer()`) | `withStellarTimeoutProxy` wraps `loadAccount`, `fetchBaseFee`, `strictSendPaths(…).call()`, `submitTransaction`, `transactions(…)…call()`, … |
| Soroban RPC (`getSorobanServer()`) | `rpc.Server({ timeout })` + `withStellarTimeoutProxy` classification. |
| RPC failover probes (`rpc-failover.ts`) | `AbortController` + `getFailoverProbeTimeoutMs()`; failover-created servers also use the Soroban budget. |
| Event source polling (`events/event-source.ts`) | `rpc.Server({ timeout })`. |
| Price oracles (`price.ts`) | `AbortController` + `getPriceTimeoutMs()` per source, combined with a caller signal. |
| Webhook delivery (`webhook-deliver.ts`) | `fetchWithTimeout(…, { timeoutMs: getWebhookTimeoutMs() })`. |

The SDK-wide `Config.setTimeout(...)` is also set from
`STELLAR_REQUEST_TIMEOUT_MS` so federation/Stellar TOML lookups inherit the
budget.

## Configuration

All values are milliseconds. An unset or non-positive value falls back to the
default (see `.env.example`).

| Variable | Default | Applies to |
|---|---|---|
| `STELLAR_REQUEST_TIMEOUT_MS` | `10000` | Umbrella Stellar budget and the SDK default |
| `HORIZON_REQUEST_TIMEOUT_MS` | `STELLAR_REQUEST_TIMEOUT_MS` | Horizon REST calls |
| `SOROBAN_RPC_TIMEOUT_MS` | `STELLAR_REQUEST_TIMEOUT_MS` | Soroban RPC calls |
| `PRICE_REQUEST_TIMEOUT_MS` | `5000` | CoinGecko / Coinbase price fetches |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Each webhook delivery attempt |
| `RPC_PROBE_TIMEOUT_MS` | `3000` | Failover health probes |

## 🛡️ Soroban RPC Circuit Breaker & Health Probe Fallback

To prevent API request thread starvation and serverless function timeouts during upstream node degradation, OphirPay enforces an automated circuit breaker pattern in `src/lib/rpc-circuit-breaker.ts` alongside multi-endpoint failover in `src/lib/rpc-failover.ts` and `src/lib/stellar-rpc.ts`:

### Circuit State Transitions

| State | Behavior | Next Transition Trigger |
|---|---|---|
| **CLOSED** | All requests and operations pass through to the primary provider. | **5 consecutive failures** (HTTP 5xx, network drops, or timeouts) trips the circuit to **OPEN**. |
| **OPEN** | Immediate fast-failure via `RpcCircuitBreakerOpenError`. Incoming API requests fail fast without blocking connection pools or exhausting request budgets. Automatically fails over to configured secondary RPC URLs. | **30-second cooldown** elapses → transitions to **HALF_OPEN**. |
| **HALF_OPEN** | Allows a controlled trial recovery probe (`getLatestLedger` / `getHealth`). | • **Probe succeeds:** Reset failure counters and recover to **CLOSED**.<br>• **Probe fails:** Immediately re-trip back to **OPEN** with a fresh 30s cooldown. |

### Observability & Metrics

- **Prometheus Counter:** `ophirpay_rpc_circuit_breaker_trips_total` tracks cumulative circuit trips across all RPC nodes.
- **Health Endpoint:** GET `/api/health` returns `circuitBreakers` with active state (`CLOSED`/`OPEN`/`HALF_OPEN`), consecutive failures, and remaining cooldown seconds.

## Error surfacing

`classifyContractError` maps a timeout to a `ContractError` of type `NETWORK`
with the message:

> The Stellar network did not respond in time. Please check your connection and
> try again.

UI surfaces render that message with a retry affordance, so a timeout is
actionable rather than an opaque failure.

---

<div align="center">

**[← Back to the README](../README.md)**

</div>
