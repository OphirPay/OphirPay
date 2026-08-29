# SSE Event Schema

OphirPay exposes a Server-Sent Events (SSE) endpoint for clients that need real-time updates for on-chain payment activity.

## Endpoint

```
GET /api/events
```

- **Content-Type:** `text/event-stream`
- **Connection:** kept alive by a heartbeat every 15 seconds
- **Fallback:** clients that cannot use WebSockets should prefer SSE; the same events are delivered over both transports

## Supported events

### `connected`

Sent once when the SSE stream is established.

```json
{
  "message": "SSE stream connected to emitter contract"
}
```

### `heartbeat`

Sent every 15 seconds to keep the HTTP connection alive through proxies and load balancers.

```json
{
  "timestamp": 1693238400000
}
```

### `payment:created`

Sent when a new payment event is read from the PaymentEventEmitter contract.

```json
{
  "id": 42,
  "event": "payment:created",
  "timestamp": "2025-08-28T12:34:56.789Z",
  "paymentId": "evt_42",
  "status": "COMPLETED",
  "emitter": "OphirPay",
  "payer": "GABC...",
  "payee": "GDEF...",
  "amount": "10000000",
  "txHash": "a1b2c3..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Emitter contract event id. Stable dedup key across reconnects. |
| `event` | `string` | Always `"payment:created"` for this event type. |
| `timestamp` | `string` | ISO 8601 timestamp generated when the event is normalized. |
| `paymentId` | `string` | Synthetic payment identifier derived from the event id (`evt_{id}`). |
| `status` | `string` | Current payment status. Usually `"COMPLETED"` for emitted events. |
| `emitter` | `string` | Emitter contract identifier. Defaults to `"OphirPay"`. |
| `payer` | `string` | Stellar public key of the payer, if available. |
| `payee` | `string` | Stellar public key of the payee, if available. |
| `amount` | `string` | Payment amount as a string to preserve precision. |
| `txHash` | `string` | On-chain transaction hash, if available. |

## Reconnection behavior

- Clients should use the `id` field for deduplication. Events with the same `id` must be processed at most once.
- The browser `EventSource` reconnects automatically on network errors with the browser's default backoff.
- On reconnect, the emitter contract is polled from the last seen event, so missed events are replayed. Duplicate filtering on the client prevents replays from being handled twice.

## Example client

```typescript
const es = new EventSource("/api/events");
const seen = new Set<number>();

es.addEventListener("payment:created", (e: MessageEvent) => {
  const event = JSON.parse(e.data) as LiveEvent;
  if (seen.has(event.id)) return; // dedup
  seen.add(event.id);

  console.log("New payment:", event.paymentId, event.amount);
});

es.addEventListener("heartbeat", (e) => {
  console.log("Heartbeat:", JSON.parse(e.data).timestamp);
});

es.onerror = () => {
  console.warn("SSE connection error; EventSource will retry automatically");
};
```

## WebSocket alternative

The same normalized `LiveEvent` payload is also delivered over the WebSocket channel at `ws://<host>:8787/api/events`. WebSockets are preferred when available because they avoid the 15-second heartbeat overhead and proxy buffering concerns inherent to SSE. Use SSE as a fallback when WebSockets are unavailable.
