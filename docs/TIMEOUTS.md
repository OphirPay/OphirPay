# ⏱️ Outbound Request Timeouts

> Every outbound call OphirPay makes to a third party carries an explicit,
> configurable timeout **and** an `AbortSignal`. A slow upstream therefore
> surfaces as a classified, renderable error instead of a hung request that
> blows the serverless request budget and returns a bare `504`.

This document is the reference for issue **#747** (timeout audit).

## The helper — `src/lib/timeout.ts`

| Export                                       | Purpose                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `TimeoutError`                               | Classified error (`code: "TIMEOUT"`, `name: "TimeoutError"`) carrying `timeoutMs` and the operation `label`.                                   |
| `isTimeoutError(err)`                        | True for our `TimeoutError`, a DOM `AbortError` raised by a timeout, or an SDK message like `timeout of 10000ms exceeded`.                     |
| `withAbortableTimeout(op, opts)`             | Runs `op(signal)` with a controller that aborts when the budget elapses; throws `TimeoutError` on expiry and links any caller-supplied signal. |
| `fetchWithTimeout(input, init, opts)`        | `fetch` + explicit timeout + `AbortSignal`. Use for every raw outbound HTTP call.                                                              |
| `withStellarTimeout(promise, opts)`          | Races an SDK promise (whose client can't take a signal) against the budget and classifies the expiry.                                          |
| `withStellarTimeoutProxy(server, ms, label)` | Wraps a Horizon/Soroban `Server` so **every** method — and fluent call builder `.call()` — is timeout-enforced.                                |
| `withTimeout(promise, ms, msg)`              | The original fire-and-forget race, kept for backwards compatibility.                                                                           |

## Where timeouts are applied

| Call path                                       | Mechanism                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Horizon (`getHorizonServer()`)                  | `withStellarTimeoutProxy` wraps `loadAccount`, `fetchBaseFee`, `strictSendPaths(…).call()`, `submitTransaction`, `transactions(…)…call()`, … |
| Soroban RPC (`getSorobanServer()`)              | `rpc.Server({ timeout })` + `withStellarTimeoutProxy` classification.                                                                        |
| RPC failover probes (`rpc-failover.ts`)         | `AbortController` + `getFailoverProbeTimeoutMs()`; failover-created servers also use the Soroban budget.                                     |
| Event source polling (`events/event-source.ts`) | `rpc.Server({ timeout })`.                                                                                                                   |
| Price oracles (`price.ts`)                      | `AbortController` + `getPriceTimeoutMs()` per source, combined with a caller signal.                                                         |
| Webhook delivery (`webhook-deliver.ts`)         | `fetchWithTimeout(…, { timeoutMs: getWebhookTimeoutMs() })`.                                                                                 |

The SDK-wide `Config.setTimeout(...)` is also set from
`STELLAR_REQUEST_TIMEOUT_MS` so federation/Stellar TOML lookups inherit the
budget.

## Configuration

All values are milliseconds. An unset or non-positive value falls back to the
default (see `.env.example`).

| Variable                     | Default                      | Applies to                                  |
| ---------------------------- | ---------------------------- | ------------------------------------------- |
| `STELLAR_REQUEST_TIMEOUT_MS` | `10000`                      | Umbrella Stellar budget and the SDK default |
| `HORIZON_REQUEST_TIMEOUT_MS` | `STELLAR_REQUEST_TIMEOUT_MS` | Horizon REST calls                          |
| `SOROBAN_RPC_TIMEOUT_MS`     | `STELLAR_REQUEST_TIMEOUT_MS` | Soroban RPC calls                           |
| `PRICE_REQUEST_TIMEOUT_MS`   | `5000`                       | CoinGecko / Coinbase price fetches          |
| `WEBHOOK_TIMEOUT_MS`         | `5000`                       | Each webhook delivery attempt               |
| `RPC_PROBE_TIMEOUT_MS`       | `3000`                       | Failover health probes                      |

## Error surfacing

`classifyContractError` maps a timeout to a `ContractError` of type `NETWORK`
with the message:

> The Stellar network did not respond in time. Please check your connection and
> try again.

UI surfaces render that message with a retry affordance, so a timeout is
actionable rather than an opaque failure.

---

## Soroban RPC Circuit Breaker & Provider Outage Fallback

To prevent application thread starvation when an upstream Soroban RPC provider suffers consecutive timeouts or HTTP 500 errors, `src/lib/rpc-circuit-breaker.ts` and `src/lib/stellar-rpc.ts` implement the **Circuit Breaker** pattern (issue #1421):

### State Machine & Failover Policy

- **CLOSED State:** All RPC interactions target the primary node (`SOROBAN_RPC_URL`). If the node responds successfully, the failure counter is reset to 0.
- **Trip Condition:** Encountering **5 consecutive failures** (HTTP 500s or network timeouts) trips the circuit to **OPEN**.
- **OPEN State (Fast Fallback):** During the **30-second cooldown**, inbound requests immediately bypass the degraded primary node and fail over to configured secondary RPC URLs (`DEFAULT_SECONDARY_RPCS`). This prevents API worker threads from stalling while waiting for individual request timeouts.
- **HALF-OPEN State & Health Probes:** Once the 30-second cooldown expires, the circuit enters **HALF-OPEN**. It sends a lightweight probe query (`getLatestLedger`) to test provider recovery:
  - If the probe succeeds, the circuit transitions back to **CLOSED** and traffic returns to primary.
  - If the probe fails, the circuit re-trips to **OPEN** for another 30-second cooldown.
- **Metrics & Telemetry:**
  - Circuit state and endpoints are exposed via `GET /api/health` under `circuitBreaker`.
  - Trips are counted in Prometheus metric `rpc_circuit_breaker_trips_total` (and `ophirpay_rpc_circuit_breaker_trips_total`).

---

<div align="center">

**[← Back to the README](../README.md)**

</div>
