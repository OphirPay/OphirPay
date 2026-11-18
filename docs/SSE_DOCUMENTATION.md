# OphirPay Server-Sent Events (SSE) Integration & Architecture Guide

## Overview

OphirPay utilizes **Server-Sent Events (SSE)** over standard HTTP/1.1 and HTTP/2 streaming connections to deliver real-time payment updates and contract audit events to client applications with sub-second delivery latency.

Unlike bidirectional WebSockets or resource-intensive client polling intervals, SSE provides a lightweight, battery-efficient, unidirectional channel from the OphirPay gateway to frontend interfaces, backend indexers, and webhook relay daemons.

The authoritative, field-by-field wire contract — payload schemas, heartbeat cadence, deduplication rules, backpressure behaviour and the sequence diagram for the polling loop — lives in [SSE.md](./SSE.md). This page is the higher-level integration and architecture guide.

---

## Architecture & Transport Protocols

OphirPay implements a dual-transport fallback strategy orchestrated by the client-side event manager:
1. **Primary Transport:** WebSocket (`ws://` / `wss://`) for interactive bidirectional sessions.
2. **Fallback & Streaming Transport:** Server-Sent Events (`http://` / `https://`) via `/api/events` and `/api/audit-log/sse`.

Both payment transports are fed by the *same* shared source: `createLiveEventSource()` polls the on-chain `PaymentEventEmitter` contract and normalizes each event into a `LiveEvent`. The SSE route and the WebSocket server therefore cannot disagree about what happened — see the [sequence diagram in SSE.md](./SSE.md#architecture-flow) for the exact call order and timings.

```
┌─────────────────────────────────────────────────────────────┐
│                    OphirPay Event Stream                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│     /api/events       │             │  /api/audit-log/sse   │
│ Payment Status Stream │             │  Contract Audit Stream│
└───────────┬───────────┘             └───────────┬───────────┘
            │                                     │
            ▼                                     ▼
   Frontend UI State                     Audit Logs & Security
 (Pending / Settled / Failed)             Compliance Relayers
```

---

## SSE Endpoints Specification

### 1. Payment Events Stream (`/api/events`)

Streams confirmed on-chain payments, including every recipient transfer of a batch disbursement and claims/releases of escrows and streams.

* **Endpoint:** `GET /api/events`
* **Response headers:**
  * `Content-Type: text/event-stream`
  * `Cache-Control: no-cache, no-transform`
  * `Connection: keep-alive`
  * `X-Accel-Buffering: no`
* **Authentication:** none — this is a public read stream of public on-chain data.

#### Frames

| Frame | When | Payload |
|---|---|---|
| `connected` | Once, on stream open | `{ "message": "SSE stream connected to emitter contract" }` |
| `heartbeat` | Every 15 s | `{ "timestamp": <epoch ms> }` |
| `payment:created` | Once per new emitter event (10 s poll) | `LiveEvent` — see below |
| `error` | Slow-consumer disconnect only | `{ "code": "SLOW_CONSUMER", "reason": "buffer-overflow" \| "idle-timeout", "message": ... }` |

A `: ping` **comment** frame (ignored by `EventSource`) is additionally sent every 20 s so proxies do not reap an idle connection.

#### `payment:created` payload

```json
{
  "id": 9842,
  "event": "payment:created",
  "timestamp": "2026-08-29T12:00:00.000Z",
  "paymentId": "evt_9842",
  "status": "COMPLETED",
  "emitter": "OphirPay",
  "payer": "GBXXX...EXAMPLE",
  "payee": "GDYYY...EXAMPLE",
  "amount": "150.0000000",
  "txHash": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
}
```

`id` is the emitter contract's event id and the only field guaranteed stable across reconnects: deduplicate on it. `timestamp` is delivery time, not on-chain time. Full field table: [SSE.md § payment:created](./SSE.md#4-paymentcreated).

> **`batch_completed` and `payment_confirmed` are not frame names.** The emitter stores one event per transfer, so a batch of 24 recipients arrives as 24 `payment:created` frames sharing a `txHash`, and every payment is already confirmed when it is streamed. Batch-level notifications exist only in the in-app notification centre (`payment.batch_completed`). See [SSE.md § Settled payments and batches](./SSE.md#settled-payments-and-batches).

---

### 2. Audit Log Stream (`/api/audit-log/sse`)

Streams security-relevant contract audit entries (role changes, multisig configuration, fee configuration, timelock actions, governance execution).

* **Endpoint:** `GET /api/audit-log/sse`
* **Response headers:** identical to `/api/events`
* **Authentication:** the route enforces none in this build — it exposes public on-chain audit data. Do not treat it as a privileged admin feed.

#### Frames

| Frame | When | Payload |
|---|---|---|
| `connected` | Once, on stream open | `{ "clientId": 3, "contractId": "C...", "message": "Audit log SSE stream connected" }` |
| `audit:entry` | Once per new audit entry (15 s poll) | contract audit entry — see below |
| `: ping` comment | Every 20 s | none (keep-alive only) |

The stream polls the `OphirPayContract` audit log every 15 s, replays existing entries on open, and auto-closes after a **10 minute** safety timeout.

#### `audit:entry` payload

```json
{
  "id": 1928,
  "timestamp": 1787980000,
  "action": "fee_config_set",
  "actor": "GBXXX...ADMIN",
  "target_id": 12,
  "details": "fee_bps=250 collector=GDYYY..."
}
```

`action` is the label recorded by the contract (snake_case, e.g. `multisig_configured`, `timelock_executed`); `timestamp` is ledger time in seconds.

---

## Client-Side Integration Examples

### React Component Implementation (Hooks Pattern)

```tsx
import React, { useEffect, useState, useRef } from "react";

interface PaymentEvent {
  id: number;
  event: "payment:created";
  paymentId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  amount: string;
  txHash?: string;
}

export function PaymentLiveTracker({ paymentId }: { paymentId: string }) {
  const [payment, setPayment] = useState<PaymentEvent | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 1. Establish SSE Connection
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnectionStatus("live");
    };

    es.onerror = () => {
      setConnectionStatus("offline");
      // The browser retries on its own; see the reconnect ladder in SSE.md.
    };

    // 2. Listen for confirmed payments
    es.addEventListener("payment:created", (event: MessageEvent) => {
      try {
        const payload: PaymentEvent = JSON.parse(event.data);
        if (payload.paymentId === paymentId) {
          setPayment(payload);
        }
      } catch (err) {
        console.error("Failed to parse SSE payload:", err);
      }
    });

    // 3. Cleanup connection on component unmount
    return () => {
      es.close();
    };
  }, [paymentId]);

  return (
    <div className="rounded-lg border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Real-Time Payment Status</h3>
        <span className={`h-2 w-2 rounded-full ${connectionStatus === "live" ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
      </div>
      {payment ? (
        <div className="space-y-1 text-sm">
          <div>Status: <span className="font-semibold">{payment.status}</span></div>
          <div>Amount: {payment.amount}</div>
          {payment.txHash && <div className="text-xs text-gray-500 truncate">Tx: {payment.txHash}</div>}
        </div>
      ) : (
        <p className="text-xs text-gray-400">Waiting for live ledger confirmation...</p>
      )}
    </div>
  );
}
```

---

## Error Handling & Resiliency Guidelines

1. **Reconnection:** the native browser `EventSource` retries a dropped stream automatically at its own interval (typically ~3 s); the route does not send a `retry:` field. The official client (`connectLiveEvents`) goes further: it prefers WebSocket, retries that with capped exponential backoff (250 ms → 500 ms → 1 s, at most 3 attempts), then falls back to SSE. Custom Node.js / Python subscribers should apply exponential backoff themselves (e.g. 1 s, 2 s, 4 s, max 30 s).
2. **Deduplication, not replay:** the stream neither replays events recorded while a client was away nor sends SSE `id:` lines, so a reconnect starts from the current emitter count. Keep a bounded seen-set keyed on the payload `id`, and reconcile gaps by reading `GET /api/payments/:id` or the emitter contract.
3. **Heartbeats:** the server emits `event: heartbeat` every 15 s plus a `: ping` comment every 20 s, so a feed that goes quiet means the connection is gone (proxy buffering, NAT timeout) rather than "no payments happened".
4. **Backpressure:** a client that stops reading is handled server-side — the bounded per-connection buffer drops the oldest frames with a `: dropped N …` comment, and a backlog that never drains is closed with an `error` frame. See [SSE.md § Backpressure](./SSE.md#backpressure--slow-consumers-issue-744).
