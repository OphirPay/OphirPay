# WebSocket Live‑Event API

The OphirPay backend exposes a real‑time event channel over WebSocket.  
It is a lightweight, stateful server that pushes live payment events to
connected clients.  The implementation lives in
`src/lib/events/live-events-ws-server.ts` and the protocol is defined in
`src/lib/events/ws-protocol.ts`.

> **⚠️ Deployment Note**  
> The WebSocket server keeps an in‑memory subscription list.  It therefore
> requires a dedicated, stateful process and does not fit a serverless
> deployment model (e.g. Vercel Edge, Netlify Functions).  If you deploy
> OphirPay to a serverless platform, the WebSocket API will not be
> available and clients will automatically fall back to the SSE
> implementation.

## 1. Server Startup

The server is started automatically in `src/instrumentation.ts`:

