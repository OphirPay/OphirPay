# ⚡ OphirPay Real-Time WebSocket Server & Protocol Specification

> Technical specification for the OphirPay standalone WebSocket live-event server. Covers the RFC 6455 wire protocol, upgrade handshake, message schemas, client reconnection and SSE fallback lifecycle, port and environment configuration, and stateful vs. serverless deployment architecture.

---

## 🧭 Architecture Overview

OphirPay delivers real-time blockchain payment notifications to client applications through a **dual-transport event system**:

1. **Primary Transport (WebSocket)**: A dedicated in-process RFC 6455 WebSocket server running on port `8787` (`ws(s)://<host>:8787/api/events`), providing low-latency push delivery with automatic ping/pong keepalives.
2. **Fallback Transport (Server-Sent Events)**: An HTTP-based SSE stream at `GET /api/events` that clients fall back to whenever WebSockets are unsupported, blocked, or unavailable (e.g. serverless hosting environments).

Both transports consume the same underlying event pipeline (`createLiveEventSource` in `src/lib/events/event-source.ts`), which polls the deployed `PaymentEventEmitter` Soroban smart contract. This guarantees that events delivered over WebSocket and SSE have **identical schemas and order semantics**.

```
                           ┌─────────────────────────────────────────────────────────────┐
                           │          PaymentEventEmitter Contract (Soroban)             │
                           └──────────────────────────────┬──────────────────────────────┘
                                                          │ polls get_event_count() & get_event(id)
                                                          ▼
                           ┌─────────────────────────────────────────────────────────────┐
                           │     createLiveEventSource (src/lib/events/event-source.ts)  │
                           └──────────────┬──────────────────────────────┬───────────────┘
                                          │                              │
                                          ▼                              ▼
                           ┌────────────────────────────┐  ┌────────────────────────────┐
                           │    LiveEventsWsServer      │  │     SSE Route Handler      │
                           │ (live-events-ws-server.ts) │  │  (app/api/events/route.ts) │
                           │ ws(s)://<host>:8787/api/events│  │   GET /api/events (HTTP)   │
                           │  RFC 6455 Stateful Server  │  │   Stateless Streaming      │
                           └──────────────┬─────────────┘  └─────────────┬──────────────┘
                                          │                             ▲
                                          │ 1. Preferred                │ 2. Fallback
                                          ▼                             │
                           ┌────────────────────────────────────────────┴───────────────┐
                           │       Client Application / Browser Integration             │
                           │      connectLiveEvents (src/lib/events/event-client.ts)    │
                           └────────────────────────────────────────────────────────────┘
```

---

## 🔌 WebSocket Server Implementation

Next.js App Router route handlers run on a request/response abstraction and do not natively support persistent, full-duplex TCP socket upgrades. OphirPay resolves this by running a lightweight, standalone Node.js `http.Server` instance dedicated exclusively to WebSocket traffic.

- **Server source**: [`src/lib/events/live-events-ws-server.ts`](../src/lib/events/live-events-ws-server.ts)
- **Protocol utilities**: [`src/lib/events/ws-protocol.ts`](../src/lib/events/ws-protocol.ts)
- **Startup hook**: [`src/instrumentation.ts`](../src/instrumentation.ts)

### Server Lifecycle & Startup Hook

The WebSocket server is booted automatically via Next.js instrumentation:

```typescript
// src/instrumentation.ts
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { bootstrap } = await import("@/lib/startup");
    await bootstrap();

    try {
      const { startLiveEventsWsServer } = await import("@/lib/events/live-events-ws-server");
      const wsServer = await startLiveEventsWsServer();
      wsServer.startEventStream();
      console.info(`[OphirPay] WebSocket event server listening on port ${wsServer.port}`);
    } catch (error) {
      console.warn(
        "[OphirPay] WebSocket event server unavailable — clients will use SSE:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
```

1. **Initialization**: On server boot in Node.js runtime, `startLiveEventsWsServer()` binds an `http.Server` to `EVENTS_WS_PORT` (default `8787`) on `0.0.0.0`.
2. **Event Stream Activation**: `wsServer.startEventStream()` spins up the contract polling source and registers an interval timer for client keep-alives.
3. **Resilience**: If port binding fails (e.g. port collision or restricted execution environment), the error is caught and logged as a warning. The application continues running without disruption, and clients seamlessly fall back to SSE.
4. **Shutdown**: `wsServer.close()` clears heartbeat timers, broadcasts RFC 6455 close frames (`0x8`) to all connected sockets, stops the event source, and closes the HTTP listener.

---

## 📜 RFC 6455 Protocol Specification

The WebSocket server implementation in `src/lib/events/ws-protocol.ts` is **dependency-free**, relying only on Node.js built-ins (`node:crypto`, `node:http`, and `node:stream`).

### 1. Upgrade Handshake

Clients initiate connection via an HTTP `GET` request containing standard RFC 6455 upgrade headers:

```http
GET /api/events HTTP/1.1
Host: localhost:8787
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

#### Server Validation & Response

1. **Path Enforcement**: The server checks `url.pathname === path` (default `/api/events`). If the path does not match or `Sec-WebSocket-Key` is missing, the underlying socket is immediately destroyed (`socket.destroy()`).
2. **Plain HTTP Handling**: Standard non-upgrade HTTP requests receive a `426 Upgrade Required` status:
   ```json
   {
     "error": {
       "code": "UPGRADE_REQUIRED",
       "message": "This endpoint only accepts WebSocket connections."
     }
   }
   ```
3. **Key Derivation (RFC 6455 §4.2.2)**: The server computes the response token by concatenating the client's `Sec-WebSocket-Key` with the magic GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, computing a SHA-1 hash, and encoding it as Base64:
   ```typescript
   export function computeAcceptKey(secWebSocketKey: string): string {
     return createHash("sha1")
       .update(secWebSocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
       .digest("base64");
   }
   ```
4. **Handshake Confirmation**: The server writes the upgrade response:
   ```http
   HTTP/1.1 101 Switching Protocols\r\n
   Upgrade: websocket\r\n
   Connection: Upgrade\r\n
   Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n
   \r\n
   ```

### 2. Supported Opcodes

| Opcode                | Value | Type    | Direction       | Description                    |
| --------------------- | ----- | ------- | --------------- | ------------------------------ |
| `OPCODE_CONTINUATION` | `0x0` | Data    | Client → Server | Fragmented frame payload chunk |
| `OPCODE_TEXT`         | `0x1` | Data    | Bidirectional   | UTF-8 JSON text payload        |
| `OPCODE_CLOSE`        | `0x8` | Control | Bidirectional   | Connection closure handshake   |
| `OPCODE_PING`         | `0x9` | Control | Bidirectional   | Liveness check probe           |
| `OPCODE_PONG`         | `0xa` | Control | Bidirectional   | Liveness check response        |

### 3. Frame Encoding (`encodeFrame`)

Server-to-client frames are **never masked** (as mandated by RFC 6455 §5.1):

- **Byte 0**: `(fin ? 0x80 : 0x00) | opcode` (all server broadcast frames set `fin = true`).
- **Payload Length**:
  - `len < 126`: 7-bit length encoded directly in Byte 1.
  - `126 <= len < 65536`: Byte 1 is `126`, followed by a 16-bit big-endian unsigned integer.
  - `len >= 65536`: Byte 1 is `127`, followed by a 64-bit big-endian unsigned integer (encoded as two 32-bit halves).

### 4. Frame Decoding (`FrameDecoder`)

Client-to-server frames are parsed by `FrameDecoder` in `ws-protocol.ts`:

- **Stateful Buffer Accumulation**: Incoming TCP chunks from `socket.on("data")` are concatenated into an internal buffer. If a partial frame arrives across TCP segments, decoding pauses until sufficient bytes are available.
- **Masking Enforcement**: Client-to-server frames must be masked (`buffer[1] & 0x80 !== 0`). A 4-byte masking key is extracted and applied via byte-wise XOR:
  ```typescript
  payload[i] ^= maskKey[i % 4];
  ```
- **Continuation & Fragmentation**: If a message arrives split across multiple continuation frames (`opcode === 0x0`), parts are buffered until a frame with `fin = true` arrives, at which point the complete message is reassembled with the initial opcode.

---

## 📦 Message Schemas

All data frames transmitted by the server are UTF-8 JSON strings (`OPCODE_TEXT`).

### 1. `connected` (Stream Welcome)

Emitted immediately upon completion of the RFC 6455 handshake:

```json
{
  "event": "connected",
  "message": "WebSocket stream connected to emitter contract"
}
```

| Field     | Type     | Description                            |
| --------- | -------- | -------------------------------------- |
| `event`   | `string` | Always `"connected"`                   |
| `message` | `string` | Human-readable connection confirmation |

### 2. `payment:created` (Live Payment Event)

Emitted whenever a new payment event is detected on-chain by the `PaymentEventEmitter` contract:

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
  "txHash": "cafebabe1234567890abcdef..."
}
```

| Field       | Type     | Description                                                                                          |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `id`        | `number` | Monotonic contract event ID — **primary deduplication key across reconnects and transport switches** |
| `event`     | `string` | Event type identifier (`"payment:created"`)                                                          |
| `timestamp` | `string` | ISO 8601 UTC timestamp generated at delivery (`new Date().toISOString()`)                            |
| `paymentId` | `string` | Synthesized application identifier, formatted as `evt_<id>`                                          |
| `status`    | `string` | Payment lifecycle state (`"COMPLETED"`)                                                              |
| `emitter`   | `string` | Emitter identity label (defaults to `"OphirPay"`)                                                    |
| `payer`     | `string` | Stellar account or contract address of the sender                                                    |
| `payee`     | `string` | Stellar account or contract address of the recipient                                                 |
| `amount`    | `string` | Payment amount formatted as a decimal string                                                         |
| `txHash`    | `string` | On-chain transaction hash                                                                            |

> **Critical Integrator Rule**: Always deduplicate messages by `id`. The `id` is guaranteed monotonic and stable across transport reconnects and failovers.

### 3. Heartbeats & Liveness Detection

To detect dead connections and prevent NAT/proxy timeouts:

- The server runs a heartbeat loop every **30 seconds** (`heartbeatMs ?? 30000`).
- On each tick:
  1. If `client.alive === false`, the socket did not answer the prior ping. The server closes and destroys the socket:
     ```typescript
     this.clients.delete(client);
     client.socket.destroy();
     ```
  2. If `client.alive === true`, the server sets `client.alive = false` and sends an unmasked `OPCODE_PING` frame with an empty payload.
  3. When the client responds with `OPCODE_PONG` (or sends its own ping), the server marks `client.alive = true`.

---

## 🔄 Reconnection & SSE Fallback Contract

The official client implementation in [`src/lib/events/event-client.ts`](../src/lib/events/event-client.ts) manages transport negotiation, automatic retries, and seamless degradation.

```
                    ┌────────────────────────────┐
                    │ connectLiveEvents(options) │
                    └─────────────┬──────────────┘
                                  │
                       Is WebSocket supported?
                                  │
                     ┌────────────┴────────────┐
                  Yes│                         │No
                     ▼                         ▼
            ┌─────────────────┐       ┌─────────────────┐
            │ Connect to WS   │       │ Connect to SSE  │
            └────────┬────────┘       └─────────────────┘
                     │
          Connection succeeds?
                     │
           ┌─────────┴─────────┐
        Yes│                   │No (initial attempt)
           ▼                   ▼
    ┌──────────────┐    ┌───────────────────────────────────┐
    │ Status: live │    │ Fallback directly to SSE          │
    └──────┬───────┘    │ Status: fallback → connecting/live│
           │            └───────────────────────────────────┘
     Socket dropped?
           │
           ▼
    Attempts < maxReconnectAttempts?
           │
     ┌─────┴─────┐
  Yes│           │No (exhausted)
     ▼           ▼
┌──────────────┐ ┌───────────────────────────────────┐
│ Reconnecting │ │ Permanent SSE Fallback            │
│ Exp. backoff │ │ Status: fallback → connecting/live│
└──────────────┘ └───────────────────────────────────┘
```

### 1. Transport Preference

1. **WebSocket First**: If the global `WebSocket` constructor is present, the client attempts to connect to `ws(s)://<host>:<port>/api/events`.
2. **Immediate Fallback**: If the initial connection fails before ever opening (`everOpened === false`), the WebSocket server is deemed unreachable (e.g. serverless hosting or blocked port). The client immediately triggers fallback mode and connects to SSE (`GET /api/events`).

### 2. Exponential Backoff on Dropped Connections

If a WebSocket connection was previously established and subsequently disconnects:

- The client attempts up to `maxReconnectAttempts` (default **3** retries).
- The retry delay follows capped exponential backoff:
  $$\text{delay} = \min(\text{maxBackoffMs}, 250 \times 2^{\text{attempt}})$$
  _(Defaults: initial delay 250 ms, doubling on each attempt, capped at 10,000 ms)._
- The client reports status `"reconnecting"` with transport `"ws"`.
- Once `maxReconnectAttempts` is exceeded, the client transitions to status `"fallback"` and establishes a permanent SSE connection (`connectSse()`).

### 3. Event Deduplication Across Transports

Because switching transports or reconnecting can cause transient overlap, the client maintains a bounded history of observed event IDs:

- Bounded window of seen IDs (`dedupWindow`, default **1,000** items).
- Before calling `onEvent(event)`, the client verifies `seen.has(event.id)`. If already seen, the event is silently ignored.
- When the window exceeds `dedupWindow`, the oldest ID is evicted.

### 4. Connection State Reference

The `onStatus(status, transport)` callback reports lifecycle transitions:

| Status         | Transport | Meaning                                                        |
| -------------- | --------- | -------------------------------------------------------------- |
| `connecting`   | `ws`      | Initial WebSocket upgrade in progress                          |
| `live`         | `ws`      | WebSocket connected and actively streaming                     |
| `reconnecting` | `ws`      | WebSocket dropped; waiting for backoff timer to retry          |
| `fallback`     | `sse`     | WebSocket unavailable or retries exhausted; switching to SSE   |
| `connecting`   | `sse`     | SSE HTTP connection establishing                               |
| `live`         | `sse`     | SSE stream established and receiving events                    |
| `offline`      | `sse`     | SSE connection interrupted (native `EventSource` reconnecting) |

---

## ⚙️ Configuration & Environment Variables

| Variable                          | Default         | Component                           | Purpose                                                  |
| --------------------------------- | --------------- | ----------------------------------- | -------------------------------------------------------- |
| `EVENTS_WS_PORT`                  | `8787`          | Server (`live-events-ws-server.ts`) | Port the in-process WebSocket HTTP server binds to       |
| `NEXT_PUBLIC_EVENTS_WS_PORT`      | `8787`          | Client (`event-client.ts`)          | Port used to construct client WebSocket connection URL   |
| `NEXT_PUBLIC_EMITTER_CONTRACT_ID` | testnet default | Server (`event-source.ts`)          | Soroban `PaymentEventEmitter` contract polled for events |
| `NEXT_PUBLIC_CHAIN_READ_SOURCE`   | testnet default | Server (`event-source.ts`)          | Public key used for read-only contract simulation        |
| `SOROBAN_RPC_URL`                 | testnet RPC     | Server (`event-source.ts`)          | Stellar RPC endpoint for contract simulations            |

### Programmatic Server Options (`WsServerOptions`)

When instantiating `LiveEventsWsServer` manually:

```typescript
export interface WsServerOptions {
  /** Port to bind to (defaults to process.env.EVENTS_WS_PORT ?? 8787). */
  port?: number;
  /** Host interface (defaults to "0.0.0.0"). */
  host?: string;
  /** HTTP path to accept upgrades on (defaults to "/api/events"). */
  path?: string;
  /** Keepalive ping interval in ms (defaults to 30000). */
  heartbeatMs?: number;
  /** Injectable event source factory (useful for unit testing). */
  eventSourceFactory?: () => LiveEventSource;
}
```

### Programmatic Client Options (`LiveEventsClientOptions`)

When calling `connectLiveEvents`:

```typescript
export interface LiveEventsClientOptions {
  /** Explicit WebSocket URL (defaults to ws(s)://<host>:<NEXT_PUBLIC_EVENTS_WS_PORT>/api/events). */
  wsUrl?: string;
  /** Explicit SSE endpoint (defaults to "/api/events"). */
  sseUrl?: string;
  /** Maximum backoff interval in ms (defaults to 10000). */
  maxBackoffMs?: number;
  /** Maximum reconnect attempts before SSE fallback (defaults to 3). */
  maxReconnectAttempts?: number;
  /** Number of seen IDs to retain for deduplication (defaults to 1000). */
  dedupWindow?: number;
  /** Event handler callback. */
  onEvent: (event: LiveEvent) => void;
  /** Connection state change callback. */
  onStatus?: (status: LiveStatus, transport: LiveTransport) => void;
}
```

---

## 🏗️ Deployment Architecture: Stateful vs. Serverless

Understanding deployment implications is crucial when deploying OphirPay:

### 1. Serverless Environments (Vercel, AWS Lambda, Cloudflare Pages)

> [!WARNING]
> **Serverless Execution Model**: Next.js App Router route handlers on Vercel run as ephemeral, stateless serverless functions. Serverless functions cannot maintain long-lived background TCP sockets or persistent event loops.

- In a serverless deployment, `src/instrumentation.ts` may execute during container boot, but port `8787` is **not routable or open to the public internet**.
- Background timers (`setInterval`) are paused when functions complete handling requests.
- **OphirPay's Built-In Resilience**: You do **not** need a separate WebSocket server when running on Vercel. When a browser visits the application:
  1. The client attempts to connect to `wss://<host>:8787/api/events`.
  2. The connection fails immediately (`everOpened === false`).
  3. The client instantly switches to `GET /api/events` (Server-Sent Events).
  4. SSE works seamlessly over standard HTTP/1.1 and HTTP/2 streaming supported by serverless platforms.

### 2. Stateful Environments (Docker, Kubernetes, VPS, Dedicated Node.js)

When running OphirPay as a persistent Node.js process (`npm run start` or Docker container):

- The WebSocket server starts on port `8787` and remains active for the lifetime of the process.
- **Port Exposure**: Ensure port `8787` is open in firewall rules and container port mappings (`-p 8787:8787`).
- **Reverse Proxy / Nginx Configuration**: When hosting behind Nginx, Traefik, or Caddy, proxy WebSocket upgrade headers properly:

```nginx
# Example Nginx configuration for OphirPay WebSocket & Web App
server {
    server_name ophirpay.example.com;

    # 1. Main Next.js web application & SSE endpoint
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for SSE (/api/events)
        proxy_buffering off;
        proxy_cache off;
    }

    # 2. WebSocket endpoint proxy (if sharing port 443 externally)
    location /api/events/ws {
        proxy_pass http://127.0.0.1:8787/api/events;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

---

## 💻 Integration Examples

### 1. React Component (Official Client)

```tsx
import React, { useEffect, useState } from "react";
import {
  connectLiveEvents,
  type LiveEvent,
  type LiveStatus,
  type LiveTransport,
} from "@/lib/events/event-client";

export function LivePaymentStream() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [status, setStatus] = useState<{
    status: LiveStatus;
    transport: LiveTransport;
  }>({
    status: "connecting",
    transport: "ws",
  });

  useEffect(() => {
    const disconnect = connectLiveEvents({
      onEvent: (event) => {
        if (event.event === "payment:created") {
          setEvents((prev) => [event, ...prev]);
        }
      },
      onStatus: (status, transport) => {
        setStatus({ status, transport });
      },
    });

    return () => {
      disconnect();
    };
  }, []);

  return (
    <div className="p-4 border rounded">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg">Live Payments</h2>
        <span className="text-xs px-2 py-1 rounded bg-muted">
          Transport: {status.transport.toUpperCase()} ({status.status})
        </span>
      </div>

      <div className="space-y-2">
        {events.map((evt) => (
          <div key={evt.id} className="p-2 border rounded text-sm">
            <span className="font-mono text-xs">{evt.paymentId}</span>:{" "}
            <strong>{evt.amount} XLM</strong> from {evt.payer.slice(0, 8)}... to{" "}
            {evt.payee.slice(0, 8)}...
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 2. Node.js Script / Integration Worker

```typescript
import { WebSocket } from "ws";

const WS_URL = process.env.EVENTS_WS_URL || "ws://localhost:8787/api/events";
const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("Connected to OphirPay WebSocket event stream");
});

ws.on("message", (data: Buffer) => {
  try {
    const message = JSON.parse(data.toString("utf8"));
    if (message.event === "payment:created") {
      console.log(`[Payment] ID ${message.id}: ${message.amount} tokens transferred`);
    } else if (message.event === "connected") {
      console.log(`[Welcome] ${message.message}`);
    }
  } catch (err) {
    console.error("Failed to parse event message:", err);
  }
});

ws.on("error", (err) => {
  console.error("WebSocket connection error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`Connection closed (${code}): ${reason.toString()}`);
});
```

---

## 📊 Transport Comparison: WebSocket vs. SSE

| Dimension                 | WebSocket (`LiveEventsWsServer`)          | Server-Sent Events (`GET /api/events`)      |
| ------------------------- | ----------------------------------------- | ------------------------------------------- |
| **Port**                  | `8787` (`EVENTS_WS_PORT`)                 | `3000` / HTTP origin port                   |
| **Protocol**              | RFC 6455 (`ws://` / `wss://`)             | HTTP/1.1 or HTTP/2 (`text/event-stream`)    |
| **Connection Direction**  | Bidirectional TCP duplex                  | Unidirectional (Server → Client)            |
| **Latency**               | Minimal socket frame overhead             | HTTP streaming response                     |
| **Serverless Ready**      | No (requires stateful Node process)       | Yes (standard Next.js Route Handler)        |
| **Keepalive**             | RFC 6455 ping/pong frames (`0x9`/`0xa`)   | SSE `heartbeat` events (every 15s)          |
| **Client Reconnect**      | Managed by `event-client.ts` with backoff | Native browser `EventSource` auto-reconnect |
| **Browser Compatibility** | All modern browsers                       | All modern browsers                         |
| **Primary Role**          | Preferred transport for active clients    | Universal fallback & serverless transport   |

---

## 🔗 Related Documentation

- [`docs/SSE.md`](SSE.md) — Server-Sent Events specification and load test suite.
- [`docs/SSE_DOCUMENTATION.md`](SSE_DOCUMENTATION.md) — SSE integration and architecture guide.
- [`docs/CONTRACT_SSE_REFERENCE.md`](CONTRACT_SSE_REFERENCE.md) — Smart contract event emission reference.
- [`src/lib/events/live-events-ws-server.ts`](../src/lib/events/live-events-ws-server.ts) — Server-side WebSocket implementation.
- [`src/lib/events/ws-protocol.ts`](../src/lib/events/ws-protocol.ts) — RFC 6455 frame encoding, decoding, and handshake.
- [`src/lib/events/event-client.ts`](../src/lib/events/event-client.ts) — Client transport manager and fallback logic.

---

<div align="center">

**[← Back to OphirPay README](../README.md)**

</div>
