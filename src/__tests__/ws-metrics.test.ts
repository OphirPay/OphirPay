// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import net from "node:net";

vi.mock("@/lib/api-auth", () => ({
  authenticateRequest: vi.fn(async () => null),
}));

vi.mock("@/lib/prisma", () => ({
  getPrismaPrometheusMetrics: vi.fn(async () => ""),
}));

import { LiveEventsWsServer } from "@/lib/events/live-events-ws-server";
import {
  getMetricsSnapshot,
  resetMetricsForTest,
} from "@/lib/metrics-counters";
import { GET } from "@/app/api/metrics/route";
import type { LiveEvent, LiveEventSource } from "@/lib/events/event-source";

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

async function startTestServer(options?: { maxBufferedBytes?: number }) {
  const fake = fakeSource();
  const server = new LiveEventsWsServer({
    port: 0,
    eventSourceFactory: () => fake.source,
    ...options,
  });
  await server.listen();
  server.startEventStream();
  servers.push(server);
  return { server, emit: fake.emit };
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

function readUntil(socket: net.Socket, marker: Buffer, timeoutMs = 2000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.removeListener("data", onData);
      reject(new Error("timed out waiting for response"));
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

function maskedClose(): Buffer {
  const maskKey = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
  const payload = Buffer.from([0x03, 0xe8]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ maskKey[i % 4];
  }
  const header = Buffer.from([0x88, 0x82]);
  return Buffer.concat([header, maskKey, masked]);
}

beforeEach(() => {
  resetMetricsForTest();
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => s.close().catch(() => undefined))
  );
});

describe("WebSocket Prometheus Telemetry (#1829)", () => {
  it("tracks active connections and normal client close", async () => {
    const { server } = await startTestServer();
    const port = server.port as number;

    expect(getMetricsSnapshot().ws_active_connections).toBe(0);

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake());
        readUntil(socket, Buffer.from("\r\n\r\n")).then(() => resolve(), reject);
      });
      socket.once("error", reject);
    });

    // Active connection incremented
    expect(getMetricsSnapshot().ws_active_connections).toBe(1);

    // Send close frame from client
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.write(maskedClose());
    await closed;

    // Active connection decremented, client_close disconnection recorded
    const snapshot = getMetricsSnapshot();
    expect(snapshot.ws_active_connections).toBe(0);
    expect(snapshot.ws_disconnections.client_close).toBe(1);
  });

  it("increments slow_consumer disconnection telemetry when outbound buffer ceiling is exceeded", async () => {
    // Set maxBufferedBytes very low to trigger slow consumer drop
    const { server, emit } = await startTestServer({ maxBufferedBytes: 10 });
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake());
        readUntil(socket, Buffer.from("\r\n\r\n")).then(() => resolve(), reject);
      });
      socket.once("error", reject);
    });

    expect(getMetricsSnapshot().ws_active_connections).toBe(1);

    const closed = new Promise<void>((resolve) => socket.once("close", resolve));

    emit({
      id: 1,
      event: "payment:created",
      timestamp: "2026-08-01T12:00:00.000Z",
      paymentId: "evt_1",
      status: "COMPLETED",
    });

    await closed;

    const snapshot = getMetricsSnapshot();
    expect(snapshot.ws_active_connections).toBe(0);
    expect(snapshot.ws_disconnections.slow_consumer).toBe(1);
  });

  it("increments ws_broadcast_frames_total on broadcast", async () => {
    const { server, emit } = await startTestServer();
    const port = server.port as number;

    const socket = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        socket.write(handshake());
        readUntil(socket, Buffer.from("\r\n\r\n")).then(() => resolve(), reject);
      });
      socket.once("error", reject);
    });

    const before = getMetricsSnapshot().ws_broadcast_frames_total;
    emit({
      id: 1,
      event: "payment:created",
      timestamp: "2026-08-01T12:00:00.000Z",
      paymentId: "evt_1",
      status: "COMPLETED",
    });

    expect(getMetricsSnapshot().ws_broadcast_frames_total).toBe(before + 1);
    socket.destroy();
  });

  it("exposes ophirpay_ws metrics in Prometheus endpoint output", async () => {
    process.env.METRICS_TOKEN = "test-token";
    const req = new Request("http://localhost/api/metrics", {
      headers: { Authorization: "Bearer test-token" },
    });
    const res = await GET(req);
    const body = await res.text();

    expect(body).toContain("# HELP ophirpay_ws_active_connections Currently active WebSocket client connections");
    expect(body).toContain("# TYPE ophirpay_ws_active_connections gauge");
    expect(body).toContain("ophirpay_ws_active_connections 0");

    expect(body).toContain("# HELP ophirpay_ws_disconnections_total WebSocket disconnections partitioned by reason");
    expect(body).toContain('# TYPE ophirpay_ws_disconnections_total counter');
    expect(body).toContain('ophirpay_ws_disconnections_total{reason="client_close"} 0');
    expect(body).toContain('ophirpay_ws_disconnections_total{reason="slow_consumer"} 0');
    expect(body).toContain('ophirpay_ws_disconnections_total{reason="ping_timeout"} 0');
    expect(body).toContain('ophirpay_ws_disconnections_total{reason="socket_error"} 0');

    expect(body).toContain("# HELP ophirpay_ws_broadcast_frames_total Total WebSocket broadcast frames sent to clients");
    expect(body).toContain("# TYPE ophirpay_ws_broadcast_frames_total counter");
    expect(body).toContain("ophirpay_ws_broadcast_frames_total 0");
  });
});
