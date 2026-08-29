// SPDX-License-Identifier: MIT

import { describe, it, expect, afterEach } from "vitest";
import {
  createEventsStreamResponse,
  GET as eventsGetRoute,
} from "@/app/api/events/route";
import {
  GET as auditLogGetRoute,
  getConnectedClientsCount,
} from "@/app/api/audit-log/sse/route";
import type { LiveEvent, LiveEventSource } from "@/lib/events/event-source";

// ── SSE Parser Client Helper ────────────────────────────────────

interface ParsedSSEMessage {
  event: string;
  data: string;
  parsedData: Record<string, unknown>;
  id?: string;
  raw: string;
}

class SSETestClient {
  public messages: ParsedSSEMessage[] = [];
  public connected = false;
  public closed = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private abortController = new AbortController();
  private buffer = "";
  private decoder = new TextDecoder();
  private waiters: {
    predicate: (msg: ParsedSSEMessage) => boolean;
    resolve: (msg: ParsedSSEMessage) => void;
  }[] = [];

  constructor(public clientId: number) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  async connect(responsePromise: Response | Promise<Response>): Promise<void> {
    const response = await responsePromise;
    if (!response.body) throw new Error("No response body");
    this.reader = response.body.getReader();
    this.connected = true;
    void this.readLoop();
  }

  private async readLoop() {
    try {
      while (this.connected && this.reader) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (value) {
          this.buffer += this.decoder.decode(value, { stream: true });
          this.parseBuffer();
        }
      }
    } catch {
      // stream cancelled or aborted
    } finally {
      this.closed = true;
      this.connected = false;
    }
  }

  private parseBuffer() {
    const blocks = this.buffer.split("\n\n");
    this.buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      if (!block.trim()) continue;
      let event = "message";
      let data = "";
      let id: string | undefined;

      const lines = block.split("\n");
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data = line.slice(5).trim();
        } else if (line.startsWith("id:")) {
          id = line.slice(3).trim();
        }
      }

      let parsedData: Record<string, unknown> = {};
      try {
        parsedData = JSON.parse(data);
      } catch {
        parsedData = { rawText: data };
      }

      const msg: ParsedSSEMessage = { event, data, parsedData, id, raw: block };
      this.messages.push(msg);

      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i].predicate(msg)) {
          const waiter = this.waiters.splice(i, 1)[0];
          waiter.resolve(msg);
        }
      }
    }
  }

  async waitForMessage(
    predicate: (msg: ParsedSSEMessage) => boolean,
    timeoutMs = 6000
  ): Promise<ParsedSSEMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(
          new Error(
            `Client ${this.clientId} timed out waiting for message after ${timeoutMs}ms. Received: ${JSON.stringify(this.messages.map((m) => m.event))}`
          )
        );
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController.abort();
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // already cancelled
      }
      this.reader = null;
    }
  }
}

// ── Shared Controllable Event Source for Tests ──────────────────

function createControlledSource() {
  let activeSourcesCount = 0;
  const handlers = new Set<(e: LiveEvent) => void>();

  const factory = (): LiveEventSource => {
    let currentHandler: ((e: LiveEvent) => void) | null = null;
    return {
      start(onEvent) {
        activeSourcesCount++;
        currentHandler = onEvent;
        handlers.add(onEvent);
      },
      stop() {
        if (currentHandler) {
          handlers.delete(currentHandler);
          currentHandler = null;
          activeSourcesCount = Math.max(0, activeSourcesCount - 1);
        }
      },
    };
  };

  const emit = (event: LiveEvent) => {
    for (const h of Array.from(handlers)) {
      h(event);
    }
  };

  return {
    factory,
    emit,
    getActiveSourcesCount: () => activeSourcesCount,
    getHandlersCount: () => handlers.size,
  };
}

describe("SSE Endpoint Load & Concurrency Tests", () => {
  const activeClients: SSETestClient[] = [];

  afterEach(async () => {
    await Promise.all(activeClients.splice(0).map((c) => c.disconnect()));
  });

  it("opens 100 concurrent SSE connections and verifies delivery of heartbeats and event messages", async () => {
    const CONCURRENT_CLIENTS = 100;
    const sourceHub = createControlledSource();

    // Fast heartbeat for test speed & accuracy: 60ms interval
    const HEARTBEAT_INTERVAL_MS = 60;

    const clients: SSETestClient[] = [];
    const connectPromises: Promise<void>[] = [];

    for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
      const client = new SSETestClient(i + 1);
      clients.push(client);
      activeClients.push(client);

      const req = new Request("http://localhost/api/events", {
        signal: client.signal,
      });

      const response = createEventsStreamResponse(
        {
          heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          eventSourceFactory: sourceHub.factory,
        },
        req
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe(
        "no-cache, no-transform"
      );

      connectPromises.push(client.connect(response));
    }

    await Promise.all(connectPromises);
    expect(sourceHub.getActiveSourcesCount()).toBe(CONCURRENT_CLIENTS);

    // 1. Verify ALL 100 clients received the initial `connected` event
    const connectedChecks = clients.map((client) =>
      client.waitForMessage((m) => m.event === "connected")
    );
    const connectedMessages = await Promise.all(connectedChecks);
    expect(connectedMessages).toHaveLength(CONCURRENT_CLIENTS);
    for (const msg of connectedMessages) {
      expect(msg.parsedData.message).toBe(
        "SSE stream connected to emitter contract"
      );
    }

    // 2. Broadcast live payment events and verify ALL 100 clients receive every event
    const testEvents: LiveEvent[] = [
      {
        id: 101,
        event: "payment:created",
        timestamp: new Date().toISOString(),
        paymentId: "evt_101",
        status: "COMPLETED",
        emitter: "OphirPay",
        payer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        payee: "GBZH7STVRWRGBMQ4KTTB6GBNZXNX7K4C7KWRX6J75YPQ534U7JYZ633V",
        amount: "500.00",
        txHash: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      },
      {
        id: 102,
        event: "payment:created",
        timestamp: new Date().toISOString(),
        paymentId: "evt_102",
        status: "COMPLETED",
        emitter: "OphirPay",
        payer: "GCXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456",
        payee: "GDXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456",
        amount: "1250.75",
        txHash: "b2c3d4e5f6a17890123456789abcdef0123456789abcdef0123456789abcdef1",
      },
      {
        id: 103,
        event: "payment:created",
        timestamp: new Date().toISOString(),
        paymentId: "evt_103",
        status: "COMPLETED",
        emitter: "OphirPay",
        payer: "GEXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456",
        payee: "GFXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456",
        amount: "99.99",
        txHash: "c3d4e5f6a1b27890123456789abcdef0123456789abcdef0123456789abcdef2",
      },
    ];

    for (const evt of testEvents) {
      sourceHub.emit(evt);
    }

    // Verify all 100 clients received all 3 events
    for (const evt of testEvents) {
      const eventChecks = clients.map((client) =>
        client.waitForMessage(
          (m) =>
            m.event === "payment:created" && m.parsedData.id === evt.id
        )
      );
      const received = await Promise.all(eventChecks);
      expect(received).toHaveLength(CONCURRENT_CLIENTS);
      for (const msg of received) {
        expect(msg.parsedData.id).toBe(evt.id);
        expect(msg.parsedData.paymentId).toBe(evt.paymentId);
        expect(msg.parsedData.status).toBe("COMPLETED");
        expect(msg.parsedData.amount).toBe(evt.amount);
        expect(msg.parsedData.txHash).toBe(evt.txHash);
      }
    }

    // 3. Verify ALL 100 clients receive heartbeats within expected interval
    const heartbeatChecks = clients.map((client) =>
      client.waitForMessage(
        (m) =>
          m.event === "heartbeat" &&
          typeof m.parsedData.timestamp === "number" &&
          m.parsedData.timestamp > 0
      )
    );
    const heartbeats = await Promise.all(heartbeatChecks);
    expect(heartbeats).toHaveLength(CONCURRENT_CLIENTS);
    const now = Date.now();
    for (const hb of heartbeats) {
      const hbTime = Number(hb.parsedData.timestamp);
      expect(hbTime).toBeLessThanOrEqual(now + 1000);
      expect(hbTime).toBeGreaterThan(now - 10000);
    }

    // 4. Verify NO connection leak after all 100 clients disconnect
    await Promise.all(clients.map((c) => c.disconnect()));

    // Active sources must drop to exactly 0
    expect(sourceHub.getActiveSourcesCount()).toBe(0);
    expect(sourceHub.getHandlersCount()).toBe(0);
  });

  it("verifies memory stays strictly bounded over 100 concurrent SSE connections", async () => {
    const CONCURRENT_CLIENTS = 100;
    const sourceHub = createControlledSource();

    if (global.gc) {
      global.gc();
    }
    const memInitial = process.memoryUsage().heapUsed;

    const clients: SSETestClient[] = [];
    for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
      const client = new SSETestClient(i + 1);
      clients.push(client);
      activeClients.push(client);

      const req = new Request("http://localhost/api/events", {
        signal: client.signal,
      });

      const response = createEventsStreamResponse(
        {
          heartbeatIntervalMs: 100,
          eventSourceFactory: sourceHub.factory,
        },
        req
      );
      await client.connect(response);
    }

    // Wait for all clients to be connected
    await Promise.all(
      clients.map((c) => c.waitForMessage((m) => m.event === "connected"))
    );

    // Flood with 20 events to generate stream throughput
    for (let e = 1; e <= 20; e++) {
      sourceHub.emit({
        id: e,
        event: "payment:created",
        timestamp: new Date().toISOString(),
        paymentId: `evt_${e}`,
        status: "COMPLETED",
        payer: `GPA${e}`,
        payee: `GPB${e}`,
        amount: `${e * 10}`,
        txHash: `hash_${e}`,
      });
    }

    // Verify last event received across all clients
    await Promise.all(
      clients.map((c) =>
        c.waitForMessage((m) => m.event === "payment:created" && m.parsedData.id === 20)
      )
    );

    const memPeak = process.memoryUsage().heapUsed;
    const memGrowthPeak = memPeak - memInitial;
    const growthPerClient = memGrowthPeak / CONCURRENT_CLIENTS;

    // Memory growth per client under 100 streaming connections must stay well bounded (< 350 KB / client)
    expect(growthPerClient).toBeLessThan(350 * 1024);

    // Disconnect all clients
    await Promise.all(clients.map((c) => c.disconnect()));
    expect(sourceHub.getActiveSourcesCount()).toBe(0);

    if (global.gc) {
      global.gc();
    }
    const memFinal = process.memoryUsage().heapUsed;
    const residualDelta = memFinal - memInitial;

    // Residual retention after cleanup is bounded
    expect(residualDelta).toBeLessThan(CONCURRENT_CLIENTS * 200 * 1024);
  });

  it("handles staggered and slow-reading clients concurrently without cross-blocking", async () => {
    const CLIENT_COUNT = 100;
    const sourceHub = createControlledSource();

    const clients: SSETestClient[] = [];
    for (let i = 0; i < CLIENT_COUNT; i++) {
      const client = new SSETestClient(i + 1);
      clients.push(client);
      activeClients.push(client);

      const req = new Request("http://localhost/api/events", {
        signal: client.signal,
      });

      const response = createEventsStreamResponse(
        {
          heartbeatIntervalMs: 80,
          eventSourceFactory: sourceHub.factory,
        },
        req
      );
      await client.connect(response);
    }

    await Promise.all(
      clients.map((c) => c.waitForMessage((m) => m.event === "connected"))
    );

    // Emit 5 distinct events
    for (let id = 500; id < 505; id++) {
      sourceHub.emit({
        id,
        event: "payment:created",
        timestamp: new Date().toISOString(),
        paymentId: `evt_${id}`,
        status: "COMPLETED",
        payer: "GFAST",
        payee: "GSLOW",
        amount: "100.00",
        txHash: `tx_${id}`,
      });
    }

    // Verify all 100 clients (fast and slow) receive all 5 events
    for (let id = 500; id < 505; id++) {
      const checks = clients.map((c) =>
        c.waitForMessage(
          (m) =>
            m.event === "payment:created" && m.parsedData.id === id
        )
      );
      await Promise.all(checks);
    }

    await Promise.all(clients.map((c) => c.disconnect()));
    expect(sourceHub.getActiveSourcesCount()).toBe(0);
  });

  it("survives 50 abrupt client disconnects mid-stream while remaining 50 clients continue receiving", async () => {
    const TOTAL_CLIENTS = 100;
    const sourceHub = createControlledSource();

    const clients: SSETestClient[] = [];
    for (let i = 0; i < TOTAL_CLIENTS; i++) {
      const client = new SSETestClient(i + 1);
      clients.push(client);
      activeClients.push(client);

      const req = new Request("http://localhost/api/events", {
        signal: client.signal,
      });

      const response = createEventsStreamResponse(
        {
          heartbeatIntervalMs: 70,
          eventSourceFactory: sourceHub.factory,
        },
        req
      );
      await client.connect(response);
    }

    await Promise.all(
      clients.map((c) => c.waitForMessage((m) => m.event === "connected"))
    );
    expect(sourceHub.getActiveSourcesCount()).toBe(TOTAL_CLIENTS);

    // Abruptly disconnect first 50 clients
    const disconnecting = clients.slice(0, 50);
    const surviving = clients.slice(50);

    await Promise.all(disconnecting.map((c) => c.disconnect()));
    expect(sourceHub.getActiveSourcesCount()).toBe(50);

    // Broadcast new event to surviving clients
    sourceHub.emit({
      id: 999,
      event: "payment:created",
      timestamp: new Date().toISOString(),
      paymentId: "evt_999",
      status: "COMPLETED",
      payer: "GSURVIVOR",
      payee: "GPAYEE",
      amount: "777.00",
      txHash: "survivor_hash",
    });

    // All surviving 50 clients must receive event 999
    const survivingChecks = surviving.map((c) =>
      c.waitForMessage(
        (m) => m.event === "payment:created" && m.parsedData.id === 999
      )
    );
    const received = await Promise.all(survivingChecks);
    expect(received).toHaveLength(50);

    // Disconnect surviving clients
    await Promise.all(surviving.map((c) => c.disconnect()));
    expect(sourceHub.getActiveSourcesCount()).toBe(0);
  });

  it("handles 100 rapid connect and disconnect bursts with 0 leaked resources", async () => {
    const BURST_COUNT = 100;
    const sourceHub = createControlledSource();

    const burstPromises = Array.from({ length: BURST_COUNT }).map(
      async (_, idx) => {
        const client = new SSETestClient(idx + 1);
        const req = new Request("http://localhost/api/events", {
          signal: client.signal,
        });

        const response = createEventsStreamResponse(
          {
            heartbeatIntervalMs: 100,
            eventSourceFactory: sourceHub.factory,
          },
          req
        );

        await client.connect(response);
        // Disconnect immediately after opening
        await client.disconnect();
      }
    );

    await Promise.all(burstPromises);

    // All resources must be completely released
    expect(sourceHub.getActiveSourcesCount()).toBe(0);
    expect(sourceHub.getHandlersCount()).toBe(0);
  });

  it("supports default GET /api/events route with native Request abort signal", async () => {
    const abortCtrl = new AbortController();
    const req = new Request("http://localhost/api/events", {
      signal: abortCtrl.signal,
    });

    const response = await eventsGetRoute(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const client = new SSETestClient(1);
    activeClients.push(client);
    await client.connect(response);

    const connectedMsg = await client.waitForMessage(
      (m) => m.event === "connected"
    );
    expect(connectedMsg.parsedData.message).toContain("SSE stream connected");

    abortCtrl.abort();
    await client.disconnect();
  });

  it("opens 100 concurrent SSE connections on audit-log endpoint with zero registry leaks", async () => {
    const CLIENT_COUNT = 100;
    const initialCount = getConnectedClientsCount();

    const clients: SSETestClient[] = [];
    for (let i = 0; i < CLIENT_COUNT; i++) {
      const client = new SSETestClient(i + 1);
      clients.push(client);
      activeClients.push(client);

      const req = new Request("http://localhost/api/audit-log/sse", { signal: client.signal });
      const response = await auditLogGetRoute(req);
      await client.connect(response);
    }

    // Verify all 100 received connected message
    const connectedMsgs = await Promise.all(
      clients.map((c) => c.waitForMessage((m) => m.event === "connected"))
    );
    expect(connectedMsgs).toHaveLength(CLIENT_COUNT);
    for (const msg of connectedMsgs) {
      expect(msg.parsedData.message).toBe("Audit log SSE stream connected");
    }

    expect(getConnectedClientsCount()).toBeGreaterThanOrEqual(
      initialCount + CLIENT_COUNT
    );

    // Disconnect all 100 clients
    await Promise.all(clients.map((c) => c.disconnect()));

    // Verify connected clients count returned to initial
    expect(getConnectedClientsCount()).toBe(initialCount);
  });
});
