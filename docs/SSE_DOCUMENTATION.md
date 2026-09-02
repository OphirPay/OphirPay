# OphirPay Server-Sent Events (SSE) Integration & Architecture Guide

## Overview

OphirPay utilizes **Server-Sent Events (SSE)** over standard HTTP/1.1 and HTTP/2 streaming connections to deliver real-time payment updates, contract audit logs, and transaction status streams to client applications with sub-second latency.

Unlike bidirectional WebSockets or resource-intensive polling intervals, SSE provides a lightweight, battery-efficient, unidirectional channel from the OphirPay gateway directly to frontend interfaces, backend indexers, and webhook relay daemons.

---

## Architecture & Transport Protocols

OphirPay implements a dual-transport fallback strategy orchestrated by the client-side event manager:
1. **Primary Transport:** WebSocket (`ws://` / `wss://`) for interactive bidirectional sessions.
2. **Fallback & Streaming Transport:** Server-Sent Events (`http://` / `https://`) via `/api/events` and `/api/audit-log/sse`.

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

Streams real-time updates for active payments, batch disbursements, escrows, and streaming payments.

* **Endpoint:** `GET /api/events`
* **Headers:**
  * `Accept: text/event-stream`
  * `Cache-Control: no-cache`
  * `Connection: keep-alive`
* **Authentication:** Session cookie or `Authorization: Bearer <API_KEY>`

#### Event Types & Payloads

##### `payment_status_update`
Emitted whenever an on-chain Stellar transaction transitions between states.

```json
{
  "event": "payment_status_update",
  "id": "evt_984f1a2e",
  "timestamp": "2026-08-29T12:00:00.000Z",
  "data": {
    "paymentId": "pay_7829104",
    "status": "COMPLETED",
    "txHash": "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890",
    "sourceAccount": "GBXXX...EXAMPLE",
    "destinationAccount": "GDYYY...EXAMPLE",
    "amount": "150.0000000",
    "assetCode": "XLM",
    "assetIssuer": null,
    "feeStroops": 100,
    "ledgerSequence": 52910423
  }
}
```

##### `batch_processed`
Emitted when a multi-recipient batch disbursement completes on-chain.

```json
{
  "event": "batch_processed",
  "data": {
    "batchId": "batch_44921",
    "totalPayments": 24,
    "totalAmount": "2400.0000000",
    "assetCode": "USDC",
    "status": "COMPLETED",
    "failedRecipients": []
  }
}
```

---

### 2. Audit Log Stream (`/api/audit-log/sse`)

Streams security events, administrative role modifications, and governance proposal executions.

* **Endpoint:** `GET /api/audit-log/sse`
* **Headers:**
  * `Accept: text/event-stream`
  * `Authorization: Bearer <ADMIN_API_KEY>`

#### Event Payload Example

```json
{
  "event": "audit_record",
  "data": {
    "id": "aud_192840",
    "action": "PROPOSAL_EXECUTED",
    "actor": "GBXXX...ADMIN",
    "target": "CONTRACT_UPGRADE",
    "status": "SUCCESS",
    "timestamp": 1787980000,
    "metadata": {
      "proposalId": 12,
      "wasmHash": "9f8e7d6c..."
    }
  }
}
```

---

## Client-Side Integration Examples

### React Component Implementation (Hooks Pattern)

```tsx
import React, { useEffect, useState, useRef } from "react";

interface PaymentEvent {
  paymentId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  amount: string;
  assetCode: string;
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
      // Browser EventSource automatically attempts reconnection every 3-5 seconds
    };

    // 2. Listen for specific payment status updates
    es.addEventListener("payment_status_update", (event: MessageEvent) => {
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
          <div>Amount: {payment.amount} {payment.assetCode}</div>
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

1. **Automatic Exponential Backoff:** Native browser `EventSource` handles connection retries automatically. When implementing custom Node.js / Python subscribers, always apply exponential backoff (e.g. 1s, 2s, 4s, max 30s).
2. **Missed Event Reconciliation:** If a client goes offline, on reconnection it should query `GET /api/payments/:id` to reconcile any states that were broadcast during the disconnection window.
3. **Heartbeat Pings:** The OphirPay SSE server transmits `:keepalive\n\n` comments every 15 seconds to prevent intermediate proxy / NAT timeouts.
