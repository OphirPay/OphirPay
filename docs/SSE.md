# 📡 OphirPay Live Event Stream (SSE) — Client Integration

> The stream contract for real-time OphirPay payment events. Covers the SSE
> endpoint, every event type with its payload schema, heartbeat/error
> behavior, reconnection semantics, and example client code.

OphirPay streams **live blockchain events** to browsers and integrations via
**Server-Sent Events (SSE)** at `GET /api/events`. The endpoint polls the
deployed `PaymentEventEmitter` Soroban contract and forwards normalized
events. A **WebSocket channel** (`/api/events` on port `8787`, see
[Reconnection & transport](#-reconnection--transport)) delivers the *same*
events with lower latency; the official client prefers it and falls back to
SSE automatically.

```
Client ←── SSE: GET /api/events ────polls──→ PaymentEventEmitter (Soroban)
        ←── WS:   ws(s)://host:8787/api/events       │
                                                     ├─ get_event_count()
                                                     └─ get_event(id)
```

## Endpoint

| Property | Value |
|---|---|
| URL | `GET /api/events` (same origin) |
| Content-Type | `text/event-stream` |
| Cache-Control | `no-cache, no-transform` |
| Connection | `keep-alive` |
| `X-Accel-Buffering` | `no` (disables proxy buffering — required behind Nginx) |
| Auth | None (public read stream) |

**Try it:**

```bash
curl -N https://ophirpay.com/api/events
# → event: connected
#   data: {"message":"SSE stream connected to emitter contract"}
#
# → event: heartbeat
#   data: {"timestamp": 1724000000000}
```

## Wire format

Standard SSE framing: `event:` name line, `data:` JSON line, blank line
terminator.

```
event: <name>
data: <json>

```

## Event types & payload schemas

### 1. `connected`

Emitted once when the stream is established.

| Field | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable confirmation |

```json
{"message": "SSE stream connected to emitter contract"}
```

### 2. `heartbeat`

Keep-alive ping emitted **every 15 seconds** so proxies and the browser don't
time out an idle stream.

| Field | Type | Description |
|---|---|---|
| `timestamp` | `number` | Unix epoch **milliseconds** (`Date.now()`) |

```json
{"timestamp": 1724000000000}
```

### 3. `payment:created`

A new payment event detected on-chain. This is the normalized `LiveEvent`
shape — identical across SSE and WebSocket transports.

| Field | Type | Description |
|---|---|---|
| `id` | `number` | Emitter contract event id — **stable dedup key** across reconnects |
| `event` | `string` | Always `"payment:created"` for this event |
| `timestamp` | `string` | ISO 8601 UTC (`new Date().toISOString()`) — time of delivery, not on-chain time |
| `paymentId` | `string` | Application payment id, formatted `evt_<id>` |
| `status` | `string` | Payment status; currently always `"COMPLETED"` |
| `emitter` | `string` | Emitter label (defaults to `"OphirPay"`) |
| `payer` | `string` | Payer Stellar address (may be empty) |
| `payee` | `string` | Payee Stellar address (may be empty) |
| `amount` | `string` | Payment amount as a decimal string (defaults to `"0"`) |
| `txHash` | `string` | Stellar transaction hash (may be empty) |

```json
{
  "id": 42,
  "event": "payment:created",
  "timestamp": "2026-08-29T09:00:00.000Z",
  "paymentId": "evt_42",
  "status": "COMPLETED",
  "emitter": "OphirPay",
  "payer": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  "payee": "GBCDEFGHIJKLMNOPQRSTUVWXYZ2345678",
  "amount": "125.50",
  "txHash": "cafebabe..."
}
```

> **Integrator rule:** deduplicate by `id`, not by `txHash` or `paymentId` —
> `id` is the only field guaranteed stable across reconnects.

### Client protocol event names

The official client listens for exactly these names: `connected`,
`heartbeat`, `payment:created`. Any other SSE frame is ignored.

## Cadence

| Interval | Value | Source |
|---|---|---|
| Emitter poll | **10 s** (`pollIntervalMs` default) | `createLiveEventSource` |
| Heartbeat | **15 s** | SSE route `setInterval` |
| WebSocket port | `8787` (`EVENTS_WS_PORT` / `NEXT_PUBLIC_EVENTS_WS_PORT`) | `live-events-ws-server.ts` |

## Reconnection & transport

### SSE (native)

- The browser's `EventSource` **reconnects automatically** on dropped
  connections — no client code needed for the happy path.
- Events are **deduplicated by `id`** (`event-source`/`event-client` keep a
  bounded seen-set of the most recent 1000 ids), so a reconnect never replays
  a duplicate `payment:created` into the UI.
- Poll failures against the emitter contract are **silent**: the next 10 s
  cycle retries.

### WebSocket (preferred) → SSE (fallback)

The official client (`connectLiveEvents`) negotiates transports:

1. **WS first** — connects to `ws(s)://<host>:8787/api/events`.
2. **On failure** (never opened): immediately falls back to SSE.
3. **On drop** after a successful open: reconnects with **exponential backoff**
   (`250ms × 2^attempt`) capped at `maxBackoffMs` (default **10 s**), up to
   `maxReconnectAttempts` (default **3**) attempts, then falls back to SSE.
4. **Malformed frames** (bad JSON) are ignored on both transports.

### Connection status

The client exposes a status enum — useful for UI indicators:

| Status | Meaning |
|---|---|
| `connecting` | Transport handshake in progress |
| `live` | Receiving events |
| `reconnecting` | WS dropped; backing off before retry |
| `fallback` | Switched to SSE (WS unavailable/exhausted) |
| `offline` | SSE connection error (native reconnection still active) |

## Errors & edge cases

| Situation | Behavior |
|---|---|
| RPC/emitter down during a poll | Poll fails silently; retried on the next 10 s cycle |
| Truncated or non-JSON frame | Frame ignored (client catches parse errors) |
| Event seen twice after reconnect | Dropped — dedup by `id` (window: last 1000 ids) |
| WS server not running | Client falls back to SSE automatically (expected in dev) |
| Proxy buffers the stream | Heartbeats pause → clients see a stale feed; set `X-Accel-Buffering: no` (already set) and `proxy_buffering off` in Nginx |

## Example clients

### Browser (JavaScript / TypeScript)

```js
// Subscribe to the SSE stream directly (no dependencies).
const es = new EventSource("/api/events");
const seen = new Set();

function handleEvent(e) {
  try {
    const event = JSON.parse(e.data);
    // Dedup by contract event id — required for reconnects.
    if (typeof event.id === "number" && seen.has(event.id)) return;
    if (typeof event.id === "number") seen.add(event.id);

    switch (e.type) {
      case "connected":
        console.log("Stream connected:", event.message);
        break;
      case "heartbeat":
        // keep-alive — ignore
        break;
      case "payment:created":
        renderPayment(event); // { id, paymentId, payer, payee, amount, txHash, ... }
        break;
    }
  } catch {
    // malformed frame — ignore
  }
}

es.addEventListener("connected", handleEvent);
es.addEventListener("heartbeat", handleEvent);
es.addEventListener("payment:created", handleEvent);
es.onerror = () => console.warn("SSE error — EventSource will reconnect");
```

### Using the official client (React)

```tsx
import { connectLiveEvents } from "@/lib/events/event-client";

useEffect(() => {
  const disconnect = connectLiveEvents({
    onEvent: (event) => {
      if (event.event === "payment:created") {
        setPayments((prev) => [event, ...prev]);
      }
    },
    onStatus: (status, transport) =>
      setStatus({ status, transport }), // "live" | "fallback" | ...
  });
  return disconnect; // cleanup on unmount
}, []);
```

### cURL (debugging)

```bash
curl -N https://ophirpay.com/api/events | \
  while IFS= read -r line; do
    case "$line" in
      "event: payment:created") echo "→ new payment" ;;
    esac
  done
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_EVENTS_WS_PORT` | `8787` | WebSocket port for the preferred transport |
| `EVENTS_WS_PORT` | `8787` | Server-side WS listen port (`live-events-ws-server.ts`) |
| `NEXT_PUBLIC_CONTRACT_ID` | testnet default | Main `OphirPayContract` (for event detail APIs) |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | testnet default | `PaymentEventEmitter` the stream polls |
| `NEXT_PUBLIC_CHAIN_READ_SOURCE` | — | Public key used for read-only contract simulations |

## Load testing (issue #391)

`scripts/sse-load-test.mjs` opens **100 concurrent SSE connections** to
`GET /api/events` and verifies the endpoint holds up under load:

- every client receives the `connected` event;
- every client receives **heartbeats within the expected interval**
  (server interval is 15s; the test asserts the first heartbeat arrives
  within `15s + 10s` tolerance and reports the observed min/max);
- **no connection leak** after clients disconnect — the server's
  `ophirpay_sse_open_connections` gauge (exposed on `/api/metrics`) returns
  to `0` and fresh connections still work afterwards;
- **memory stays bounded** — server heap/RSS deltas sampled from
  `/api/metrics` during the run, and the harness's own heap, must stay under
  generous limits.

```bash
# Requires a running OphirPay server (dev or production build)
npm run start            # in one terminal (or: npm run dev)
npm run test:sse:load    # in another

# Customise the run
BASE_URL=https://staging.example.com CONCURRENCY=250 DURATION_MS=20000 \
  npm run test:sse:load
```

The exit code is `0` on success and `1` if any acceptance check fails. It
runs automatically on every PR in CI (shard 1 of the `e2e-tests` job, after
the production build is served).

## Reference implementation

- Route: `src/app/api/events/route.ts`
- Shared event source & types: `src/lib/events/event-source.ts`
- Client with transport fallback: `src/lib/events/event-client.ts`
- WebSocket server: `src/lib/events/live-events-ws-server.ts`
- Live events page: `src/app/events/page.tsx`

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
