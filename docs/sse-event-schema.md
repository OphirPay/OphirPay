# SSE Event Schema

OphirPay streams live payment events via Server-Sent Events (SSE) and WebSocket, both backed by the on-chain PaymentEventEmitter Soroban contract.

## Transport Options

| Transport | Endpoint | Protocol | Latency |
|-----------|----------|----------|---------|
| SSE | `/api/events` | HTTP long-poll | Medium |
| WebSocket | `wss://host:8787/api/events` | Full-duplex (WSS) | Low |

Both transports deliver the same event stream. The client library (`LiveEventsClient`) auto-negotiates WebSocket first and falls back to SSE. **Always use WSS (secure WebSocket) in production** — cleartext `ws://` exposes payment data to interception.

## Event Types

### `connected`

Sent once when a new SSE or WebSocket connection is established.

```json
{
  "event": "connected",
  "timestamp": "2026-08-28T12:00:00.000Z",
  "id": 0
}
```

### `heartbeat`

Sent every 30 seconds to keep the connection alive and detect dropped connections.

```json
{
  "event": "heartbeat",
  "timestamp": "2026-08-28T12:00:30.000Z",
  "id": 0
}
```

### `payment:created`

Emitted when a new payment is created on-chain and indexed.

```json
{
  "id": 127,
  "event": "payment:created",
  "timestamp": "2026-08-28T12:01:00.000Z",
  "paymentId": "pay_abc123",
  "status": "pending",
  "payer": "GABCD...",
  "payee": "GEFGH...",
  "amount": "100.50",
  "txHash": "abc123def456..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique dedup key (emitter contract event id) |
| `event` | string | Event type identifier |
| `timestamp` | ISO 8601 | When the event was indexed |
| `paymentId` | string | Payment identifier |
| `status` | string | `pending`, `processing`, `completed`, `failed` |
| `payer` | string (optional) | Stellar public key of sender |
| `payee` | string (optional) | Stellar public key of recipient |
| `amount` | string (optional) | Token amount |
| `txHash` | string (optional) | Stellar transaction hash |

### `payment:confirmed`

Emitted when a payment reaches finality on-chain.

```json
{
  "id": 128,
  "event": "payment:confirmed",
  "timestamp": "2026-08-28T12:05:00.000Z",
  "paymentId": "pay_abc123",
  "status": "completed",
  "txHash": "xyz789..."
}
```

### `error`

Emitted by the SSE/WS server on internal errors (not payment failures).

```json
{
  "event": "error",
  "timestamp": "2026-08-28T12:00:00.000Z",
  "message": "Temporary RPC connection failure"
}
```

## Reconnection Behavior

1. **SSE**: The browser's `EventSource` automatically reconnects after connection loss. The `Last-Event-ID` header is sent with the last received `id` for event replay.
2. **WebSocket**: The client library implements exponential backoff (1s → 2s → 4s → ... → 10s max). After `maxReconnectAttempts` (default 5), it falls back to SSE.
3. **Deduplication**: Both transports deduplicate by `id`. Reconnects never replay duplicates into the UI.

## Client Example (JavaScript)

```javascript
// SSE (simple)
const es = new EventSource("/api/events");
es.addEventListener("payment:created", (e) => {
  const data = JSON.parse(e.data);
  console.log(`New payment: ${data.paymentId} — ${data.amount} XLM`);
});
es.addEventListener("heartbeat", () => console.log("Connection alive"));

// WebSocket + SSE with auto-fallback (recommended)
import { connectLiveEvents } from "@/lib/events/event-client";

const disconnect = connectLiveEvents({
  onEvent: (event) => {
    if (event.event === "payment:created") {
      console.log(`Payment ${event.paymentId}: ${event.amount}`);
    }
  },
  onStatus: (status, transport) => {
    console.log(`Connection: ${status} via ${transport}`);
  },
});

// Later: disconnect();
```

## Client Example (Python)

```python
import json
try:
    from sseclient import SSEClient
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "sseclient-py"])
    from sseclient import SSEClient

for event in SSEClient("https://app.ophirpay.com/api/events"):
    if event.event == "heartbeat":
        continue
    data = json.loads(event.data)
    if data["event"] == "payment:created":
        print(f"New payment {data['paymentId']}: {data['amount']}")
```

## Best Practices

- **Always handle heartbeats**: Ignore heartbeat events in your handler; they exist only for connection keep-alive.
- **Dedup by `id`**: Keep a Set of last N ids to prevent double-processing on reconnect.
- **Reconnect gracefully**: Implement exponential backoff with a max cap.
- **Monitor connection status**: Track `LiveStatus` changes to show connection health in the UI.
