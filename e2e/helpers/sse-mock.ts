// SPDX-License-Identifier: MIT
//
// Controllable SSE mock for E2E tests.
//
// The notification center subscribes to GET /api/events via the browser's
// EventSource. In CI and local runs there is no deterministic way to make the
// real endpoint emit on-demand `payment:created` events, so this helper
// redirects the request to a real local HTTP server that speaks
// text/event-stream and is driven by the test.
//
// A real server is required because Playwright's `route.fulfill()` cannot
// stream a ReadableStream body — fulfill buffers the (infinite) stream, the
// browser never sees a byte, and EventSource aborts. `route.continue({url})`
// proxies to our server over real HTTP, so streaming works end to end while
// the page's actual hook code, React state and DOM all run unmodified — only
// the network boundary is mocked.
//
// Usage:
//   const sse = installSseMock(page);
//   await page.goto("/");
//   await sse.waitForNextClient();     // EventSource is open
//   sse.emit("payment:created", { id: "e2e-1", amount: 5, payee: "GC..." });
//   sse.drop();                        // close the stream → EventSource reconnects
//   await sse.waitForNextClient(1);    // resolve when the reconnect lands

import type { Page } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface SseMock {
  /** Enqueue one SSE frame to the active connection (no-op if not connected). */
  emit: (event: string, data: unknown) => void;
  /** Close the current stream; the browser EventSource will reconnect. */
  drop: () => void;
  /** Number of SSE requests the page has made so far (reconnects included). */
  clientCount: () => number;
  /** Resolve once a *new* SSE client connects after the given one. */
  waitForNextClient: (afterIndex?: number) => Promise<void>;
}

export function installSseMock(page: Page): SseMock {
  const encoder = new TextEncoder();
  let connections: http.ServerResponse[] = [];
  let clientCount = 0;
  const nextClientWaiters: { afterIndex: number; resolve: () => void }[] = [];

  const frame = (event: string, data: unknown): string =>
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  const server = http.createServer((_req, res) => {
    const index = clientCount++;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // route.continue() proxies cross-origin, so the stream must be readable.
      "Access-Control-Allow-Origin": "*",
    });
    // Mirror the real endpoint: emit `connected` as soon as the stream opens.
    res.write(frame("connected", { message: "SSE stream (mocked)" }));
    connections.push(res);
    res.on("close", () => {
      connections = connections.filter((c) => c !== res);
    });

    // Wake any waiters that were waiting for this client index.
    for (const waiter of nextClientWaiters) {
      if (index >= waiter.afterIndex) waiter.resolve();
    }
  });

  // The port is assigned when the listen callback fires; register the route
  // immediately (before any navigation) and pin the URL lazily from the
  // promise so the first EventSource request is already intercepted.
  const listening = new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  // Route the page's EventSource requests to the local server.
  page.route("**/api/events", (route) => {
    void listening.then(() => {
      const port = (server.address() as AddressInfo).port;
      route.continue({ url: `http://127.0.0.1:${port}/sse` }).catch(() => {
        // Request aborted (e.g. page navigation) — nothing to do.
      });
    });
  });

  return {
    emit(event, data) {
      const conn = connections[connections.length - 1];
      if (conn && !conn.writableEnded) conn.write(frame(event, data));
    },
    drop() {
      const conn = connections[connections.length - 1];
      if (conn && !conn.writableEnded) conn.end();
    },
    clientCount: () => clientCount,
    waitForNextClient(afterIndex = 0) {
      if (clientCount > afterIndex) return Promise.resolve();
      return new Promise((resolve) => {
        nextClientWaiters.push({ afterIndex, resolve });
      });
    },
  };
}