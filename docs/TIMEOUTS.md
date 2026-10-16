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

## Error surfacing

`classifyContractError` maps a timeout to a `ContractError` of type `NETWORK`
with the message:

> The Stellar network did not respond in time. Please check your connection and
> try again.

UI surfaces render that message with a retry affordance, so a timeout is
actionable rather than an opaque failure.

## Soroban RPC Circuit Breaker & Fallback (Issue #1421)

To protect serverless threads and background workers from blocking indefinitely against failing Soroban or Horizon RPC providers, OphirPay deploys an automated three-state Circuit Breaker (`src/lib/rpc-circuit-breaker.ts` and `src/lib/stellar-rpc.ts`):

```
         ┌───────────────────┐
         │      CLOSED       │ ◄─────────────────────┐
         │ (Normal Traffic)  │                       │
         └─────────┬─────────┘                       │
                   │ 5 Consecutive Failures          │
                   ▼                                 │ Single Successful
         ┌───────────────────┐                       │ Probe / Trial
         │       OPEN        │                       │
         │  (Fail-Fast Rej.) │                       │
         └─────────┬─────────┘                       │
                   │ 30s Cooldown Expires            │
                   ▼                                 │
         ┌───────────────────┐                       │
         │     HALF_OPEN     │ ──────────────────────┘
         │ (Probe Recovery)  │
         └─────────┬─────────┘
                   │ Probe Failure
                   ▼
               (Re-trip to OPEN)
```

### Operational Rules

1. **Failure Threshold**: After **5 consecutive** network timeouts or HTTP 5xx responses, the endpoint circuit trips to `OPEN`.
2. **Fail-Fast Rejection**: While `OPEN`, subsequent API requests to the endpoint immediately throw `RpcCircuitOpenError` with a non-zero `retryAfterMs` instead of waiting for a 10-second timeout budget.
3. **Automated Secondary Failover**: `stellarRpcClient.executeWithFailover()` automatically routes incoming requests to configured secondary fallback RPC endpoints (`DEFAULT_FALLBACK_RPC_URLS` or `STELLAR_RPC_FALLBACK_URLS`).
4. **Cooldown & Probe Recovery**: After **30 seconds** in `OPEN`, the circuit enters `HALF_OPEN`. A lightweight recovery probe query (`getLatestLedger`) tests upstream availability; when successful, the circuit returns to `CLOSED`.
5. **Observability & Metrics**:
   - Every trip to `OPEN` increments the Prometheus counter `rpc_circuit_breaker_trips_total`.
   - The active circuit breaker status for all endpoints is surfaced by `GET /api/health` under `rpcCircuitBreaker`.
   - If the primary RPC circuit trips `OPEN`, the overall system health state transitions to `degraded`.

---

<div align="center">

**[← Back to the README](../README.md)**

</div>
