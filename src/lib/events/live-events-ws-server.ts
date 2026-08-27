// SPDX-License-Identifier: MIT

/**
 * Standalone WebSocket event server.
 *
 * Next.js App Router route handlers are HTTP-only, so the WebSocket channel
 * lives on its own in-process Node server (started from instrumentation.ts).
 * It subscribes to the same `createLiveEventSource` as the SSE route, so both
 * transports deliver the identical event stream. When this server isn't
 * reachable (e.g. serverless deploys), the client automatically falls back
 * to the SSE route.
 */

import http from "node:http";
import type { Duplex } from "node:stream";
import {
  computeAcceptKey,
  encodeFrame,
  FrameDecoder,
  OPCODE_TEXT,
  OPCODE_CLOSE,
  OPCODE_PING,
  OPCODE_PONG,
} from "./ws-protocol";
import {
  createLiveEventSource,
  type LiveEvent,
  type LiveEventSource,
} from "./event-source";

export interface WsServerOptions {
  port?: number;
  host?: string;
  /** Only this URL path is upgraded; everything else gets 426. */
  path?: string;
  /** Protocol-level keepalive interval. */
  heartbeatMs?: number;
  /** Injectable source factory for tests. */
  eventSourceFactory?: () => LiveEventSource;
}

interface WsClient {
  socket: Duplex;
  alive: boolean;
}

export class LiveEventsWsServer {
  private server: http.Server | null = null;
  private clients = new Set<WsClient>();
  private source: LiveEventSource | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private options: WsServerOptions = {}) {}

  get port(): number | undefined {
    const addr = this.server?.address();
    return typeof addr === "object" && addr !== null
      ? addr.port
      : this.options.port;
  }

  private get path(): string {
    return this.options.path ?? "/api/events";
  }

  /**
   * Start listening. Resolves once the port is bound.
   */
  listen(): Promise<void> {
    if (this.server) return Promise.resolve();

    const server = http.createServer((req, res) => {
      // Plain HTTP requests to the WS endpoint are rejected explicitly.
      res.writeHead(426, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "UPGRADE_REQUIRED",
            message: "This endpoint only accepts WebSocket connections.",
          },
        })
      );
    });

    server.on("upgrade", (req, socket) => this.handleUpgrade(req, socket));

    this.server = server;

    return new Promise((resolve) => {
      server.listen(this.options.port ?? 0, this.options.host ?? "0.0.0.0", () => {
        resolve();
      });
    });
  }

  /**
   * Broadcast a message to every connected client.
   */
  broadcast(payload: string): void {
    const frame = encodeFrame(OPCODE_TEXT, payload);
    for (const client of this.clients) {
      client.socket.write(frame);
    }
  }

  /**
   * Start the shared event source and fan its events out to all clients.
   */
  startEventStream(): void {
    if (this.source) return;
    const factory = this.options.eventSourceFactory ?? createLiveEventSource;
    this.source = factory();
    this.source.start((event: LiveEvent) => this.broadcast(JSON.stringify(event)));

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          this.clients.delete(client);
          client.socket.destroy();
          continue;
        }
        client.alive = false;
        client.socket.write(encodeFrame(OPCODE_PING, Buffer.alloc(0)));
      }
    }, this.options.heartbeatMs ?? 30000);
  }

  /**
   * Stop the server, drop all clients, and stop the event source.
   */
  close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.source?.stop();
    this.source = null;

    for (const client of this.clients) {
      try {
        client.socket.end(encodeFrame(OPCODE_CLOSE, Buffer.alloc(0)));
      } catch {
        client.socket.destroy();
      }
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (!this.server) return resolve();
      const server = this.server;
      this.server = null;
      server.close(() => resolve());
    });
  }

  // ── Internals ─────────────────────────────────────────────────

  private handleUpgrade(req: http.IncomingMessage, socket: Duplex): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== this.path) {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.destroy();
      return;
    }

    // RFC 6455 handshake.
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n` +
        "\r\n"
    );

    const client: WsClient = { socket, alive: true };
    this.clients.add(client);

    // Announce the connection with the same event the SSE route emits.
    socket.write(
      encodeFrame(
        OPCODE_TEXT,
        JSON.stringify({
          event: "connected",
          message: "WebSocket stream connected to emitter contract",
        })
      )
    );

    const decoder = new FrameDecoder();

    socket.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        this.handleFrame(client, frame);
      }
    });

    const cleanup = () => {
      this.clients.delete(client);
      socket.removeAllListeners("data");
      socket.removeAllListeners("close");
      socket.removeAllListeners("error");
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  }

  private handleFrame(client: WsClient, frame: { opcode: number; payload: Buffer }): void {
    switch (frame.opcode) {
      case OPCODE_PING:
        client.socket.write(encodeFrame(OPCODE_PONG, frame.payload));
        client.alive = true;
        break;
      case OPCODE_PONG:
        client.alive = true;
        break;
      case OPCODE_CLOSE:
        // Echo the close frame and close the socket.
        try {
          client.socket.end(encodeFrame(OPCODE_CLOSE, frame.payload));
        } catch {
          client.socket.destroy();
        }
        break;
      case OPCODE_TEXT:
        // The official client sends no text; tolerate anything a custom
        // client might send without acting on it.
        break;
      default:
        break;
    }
  }
}

/**
 * Convenience: create the server from env config and start listening.
 */
export async function startLiveEventsWsServer(
  options: WsServerOptions = {}
): Promise<LiveEventsWsServer> {
  const server = new LiveEventsWsServer({
    port: Number(process.env.EVENTS_WS_PORT ?? 8787),
    ...options,
  });
  await server.listen();
  return server;
}
