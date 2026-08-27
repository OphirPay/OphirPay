// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import http from "node:http";
import { LiveEventsWsServer } from "@/lib/events/live-events-ws-server";
import {
  FrameDecoder,
  computeAcceptKey,
} from "@/lib/events/ws-protocol";
import type { LiveEvent, LiveEventSource } from "@/lib/events/event-source";

// ── Helpers ─────────────────────────────────────────────────────

const servers: LiveEventsWsServer[] = [];

function fakeSource(): { source: LiveEventSource; emit: (e: LiveEvent) => void } {
  let handler: ((e: LiveEvent) => void) | null = null;
  return {
    source: {
      start(onEvent) {
        handler = onEvent;
      },
      stop() {
        handler = null;
      },
    },
    emit(event) {
      handler?.(event);
    },
  };
}

async function startTestServer() {
  const fake = fakeSource();
  const server = new LiveEventsWsServer({
    port: 0,
    eventSourceFactory: () => fake.source,
  });
  await server.listen();
  server.startEventStream();
  servers.push(server);
  return { server, emit: fake.emit };
}

/** Reads frames from a socket as they arrive (queues anything early). */
class SocketFrames {
  private decoder = new FrameDecoder();
  private queue: { opcode: number; payload: Buffer }[] = [];
  private waiters: {
    resolve: (f: { opcode: number; payload: Buffer }) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(socket: net.Socket, initial: Buffer = Buffer.alloc(0)) {
    // The server may write the 101 response and the first frame in the same
    // TCP segment; feed any bytes that trailed the handshake marker.
    this.feed(initial);
    socket.on("data", (chunk: Buffer) => this.feed(chunk));
  }

  private feed(chunk: Buffer) {
    for (const frame of this.decoder.push(chunk)) {
      const waiter = this.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
      } else {
        this.queue.push(frame);
      }
    }
  }

  next(timeoutMs = 2000): Promise<{ opcode: number; payload: Buffer }> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for a WebSocket frame")),
        timeoutMs
      );
      this.waiters.push({ resolve, timer });
    });
  }
}

/** Wait for a byte sequence (e.g. the handshake response terminator). */
function readUntil(socket: net.Socket, marker: Buffer, timeoutMs = 2000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.removeListener("data", onData);
      reject(new Error("timed out waiting for handshake response"));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      const idx = acc.indexOf(marker);
      if (idx !== -1) {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        resolve(acc);
      }
    };
    socket.on("data", onData);
  });
}

function maskedFrame(opcode: number, payload: Buffer): Buffer {
  const maskKey = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ maskKey[i % 4];
  }
  const header = Buffer.alloc(payload.length < 126 ? 2 : 0);
  if (payload.length < 126) {
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payload.length;
    return Buffer.concat([header, maskKey, masked]);
  }
  header[0] = 0x80 | opcode;
  header[1] = 0x80 | 126;
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length);
  return Buffer.concat([header, len, maskKey, masked]);
}

function maskedText(text: string): Buffer {
  return maskedFrame(0x1, Buffer.from(text, "utf8"));
}

function maskedClose(): Buffer {
  return maskedFrame(0x8, Buffer.from([0x03, 0xe8])); // 1000 normal closure
}

function handshake(path = "/api/events"): string {
  return (
    `GET ${path} HTTP/1.1\r\n` +
    "Host: localhost\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
    "Sec-WebSocket-Version: 13\r\n" +
    "\r\n"
  );
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => s.close().catch(() => undefined))
  );
});

// ── Tests ──────────────────────────────────────────────────────

describe("LiveEventsWsServer", () => {
  it("performs the RFC 6455 handshake and announces the connection", async () => {
    const { server } = await startTestServer();
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const handshakeBuf = await new Promise<Buffer>((resolve, reject) => {
      socket.once("connect", () => socket.write(handshake()));
      socket.once("error", reject);
      readUntil(socket, Buffer.from("\r\n\r\n")).then(resolve, reject);
    });

    const marker = Buffer.from("\r\n\r\n");
    const markerIdx = handshakeBuf.indexOf(marker);
    const text = handshakeBuf.subarray(0, markerIdx).toString("utf8");
    const remainder = handshakeBuf.subarray(markerIdx + marker.length);
    expect(text).toContain("HTTP/1.1 101 Switching Protocols");
    expect(text).toContain("Upgrade: websocket");
    expect(text).toContain(
      `Sec-WebSocket-Accept: ${computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")}`
    );

    // The server sends the `connected` message right after upgrading.
    const frames = new SocketFrames(socket, remainder);
    const connected = await frames.next();
    expect(JSON.parse(connected.payload.toString("utf8")).event).toBe(
      "connected"
    );

    socket.destroy();
  });

  it("broadcasts live events from the shared event source to clients", async () => {
    const { server, emit } = await startTestServer();
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const handshakeBuf = await new Promise<Buffer>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake());
        readUntil(socket, Buffer.from("\r\n\r\n")).then(resolve, reject);
      });
      socket.once("error", reject);
    });

    const marker = Buffer.from("\r\n\r\n");
    const markerIdx = handshakeBuf.indexOf(marker);
    const remainder = handshakeBuf.subarray(markerIdx + marker.length);
    const frames = new SocketFrames(socket, remainder);
    await frames.next(); // connected

    const event: LiveEvent = {
      id: 42,
      event: "payment:created",
      timestamp: "2026-08-01T12:00:00.000Z",
      paymentId: "evt_42",
      status: "COMPLETED",
      payer: "GPAYER",
      payee: "GPAYEE",
      amount: "10000000",
      txHash: "abcdef",
    };
    emit(event);

    const frame = await frames.next();
    expect(frame.opcode).toBe(0x1);
    expect(JSON.parse(frame.payload.toString("utf8"))).toEqual(event);

    socket.destroy();
  });

  it("answers pings with pongs and honors close", async () => {
    const { server } = await startTestServer();
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const handshakeBuf = await new Promise<Buffer>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake());
        readUntil(socket, Buffer.from("\r\n\r\n")).then(resolve, reject);
      });
      socket.once("error", reject);
    });

    const marker = Buffer.from("\r\n\r\n");
    const markerIdx = handshakeBuf.indexOf(marker);
    const remainder = handshakeBuf.subarray(markerIdx + marker.length);
    const frames = new SocketFrames(socket, remainder);
    await frames.next(); // connected

    // Masked ping from the client → masked-free pong back.
    socket.write(maskedFrame(0x9, Buffer.from("probe")));
    const pong = await frames.next();
    expect(pong.opcode).toBe(0xa);
    expect(pong.payload.toString("utf8")).toBe("probe");

    // Masked close → server echoes close and drops the connection.
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.write(maskedClose());
    const closeFrame = await frames.next();
    expect(closeFrame.opcode).toBe(0x8);
    await closed;
  });

  it("destroys connections that request a non-event path", async () => {
    const { server } = await startTestServer();
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake("/other"));
        resolve();
      });
      socket.once("error", reject);
    });
    await closed;
  });

  it("rejects plain HTTP requests with 426", async () => {
    const { server } = await startTestServer();
    const port = server.port as number;

    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get(
        { port, host: "127.0.0.1", path: "/api/events" },
        (r) => resolve(r)
      );
      req.once("error", reject);
    });
    expect(res.statusCode).toBe(426);
    res.resume();
  });

  it("accepts a client's masked text frame without breaking the connection", async () => {
    const { server, emit } = await startTestServer();
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const handshakeBuf = await new Promise<Buffer>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake());
        readUntil(socket, Buffer.from("\r\n\r\n")).then(resolve, reject);
      });
      socket.once("error", reject);
    });

    const marker = Buffer.from("\r\n\r\n");
    const markerIdx = handshakeBuf.indexOf(marker);
    const remainder = handshakeBuf.subarray(markerIdx + marker.length);
    const frames = new SocketFrames(socket, remainder);
    await frames.next(); // connected

    socket.write(maskedText("hello server"));
    // The stream keeps working after the text frame.
    emit({ id: 1, event: "payment:created", timestamp: "", paymentId: "evt_1", status: "COMPLETED" });
    const frame = await frames.next();
    expect(JSON.parse(frame.payload.toString("utf8")).id).toBe(1);

    socket.destroy();
  });
});
