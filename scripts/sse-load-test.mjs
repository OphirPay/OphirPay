#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// OphirPay — SSE Load Test (100 concurrent clients)
//
// Issues: #391
// Acceptance criteria:
//   1. 100 concurrent SSE connections open against GET /api/events
//   2. All clients receive `connected` and heartbeat messages within the
//      expected interval (server emits one heartbeat every 15s)
//   3. No connection leak after clients disconnect — the server's
//      `ophirpay_sse_open_connections` gauge returns to 0 and fresh
//      connections still work afterwards
//   4. Memory stays bounded over the test run — server heap/RSS deltas
//      (from /api/metrics) and the harness's own memory stay under limits
//
// Usage:
//   node scripts/sse-load-test.mjs                     # default: http://localhost:3000
//   BASE_URL=https://staging.example.com node scripts/sse-load-test.mjs
//   CONCURRENCY=250 DURATION_MS=20000 node scripts/sse-load-test.mjs
//   npm run test:sse:load
//
// The test requires a running OphirPay server (dev or production build).
// It exits 0 on success and 1 on any failed acceptance check.

const BASE_URL = (process.env.BASE_URL || process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const ENDPOINT = `${BASE_URL}/api/events`;
const METRICS_URL = `${BASE_URL}/api/metrics`;
const CONCURRENCY = Number(process.env.CONCURRENCY || 100);
const DURATION_MS = Number(process.env.DURATION_MS || 40_000);
const HEARTBEAT_INTERVAL_MS = 15_000; // server interval (src/app/api/events/route.ts)
const HEARTBEAT_GRACE_MS = 10_000; // tolerated scheduling jitter
const CONNECT_TIMEOUT_MS = 10_000;
const SAMPLE_INTERVAL_MS = 2_000;
const SETTLE_MS = 3_000; // wait after disconnect before leak checks

// Memory bounds (bytes). Generous so slow CI runners never flake, but tight
// enough to catch genuine unbounded growth / connection leaks.
const MAX_SERVER_HEAP_DELTA = 160 * 1024 * 1024;
const MAX_SERVER_RSS_DELTA = 256 * 1024 * 1024;
const MAX_SERVER_HEAP_DELTA_AFTER = 96 * 1024 * 1024;
const MAX_SERVER_RSS_DELTA_AFTER = 128 * 1024 * 1024;
const MAX_HARNESS_HEAP_DELTA = 96 * 1024 * 1024;

// ── Logging helpers ────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (msg) => console.log(`   \x1b[32m✔\x1b[0m ${msg}`);
const fail = (msg) => console.log(`   \x1b[31m✖\x1b[0m ${msg}`);
const info = (msg) => console.log(`   \x1b[36mℹ\x1b[0m ${msg}`);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;

// ── SSE client using fetch + ReadableStream (no dependencies) ──
//
// Node has no browser EventSource that exposes heartbeat timing, so each
// client reads the raw SSE bytes and parses `event:`/`data:` frames itself.
function openSseClient(index, abortSignal, state) {
  const client = {
    index,
    connectedAt: null, // ms after connect at which `connected` arrived
    heartbeatCount: 0,
    firstHeartbeatAt: null, // ms after connect at which the first heartbeat arrived
    lastHeartbeatAt: null,
    eventCount: 0,
    connectResolved: false,
    error: null,
    closedAt: null,
  };
  state.started += 1;

  const run = (async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(ENDPOINT, {
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
        signal: abortSignal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} — expected text/event-stream`);
      }

      // Resolve the connect bookkeeping once the TCP/HTTP response is up.
      resolveConnect(client, t0, state);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const eventName = (frame.match(/^event:\s*(.+)$/m) || [])[1]?.trim() || "message";
          if (eventName === "connected") resolveConnect(client, t0, state);
          if (eventName === "heartbeat") {
            client.heartbeatCount += 1;
            const at = Date.now() - t0;
            if (client.firstHeartbeatAt === null) client.firstHeartbeatAt = at;
            client.lastHeartbeatAt = at;
          }
          if (eventName === "payment:created") client.eventCount += 1;
        }
      }
    } catch (err) {
      // AbortError is the expected teardown signal; anything else is a failure.
      if (!(err && err.name === "AbortError")) {
        client.error = err.message;
      }
    } finally {
      client.closedAt = Date.now();
      state.settled += 1;
    }
    return client;
  })();

  // Expose both the live client object (for assertions) and the read-loop
  // promise (for teardown) — callers must not mistake the promise for the
  // client's fields.
  return { client, run };
}

function resolveConnect(client, t0, state) {
  if (!client.connectResolved) {
    client.connectResolved = true;
    client.connectedAt = Date.now() - t0;
    state.connected += 1;
  }
}

// ── Server metrics via /api/metrics ────────────────────────────
async function fetchServerMetrics() {
  const sample = {
    heapUsed: null,
    heapTotal: null,
    rss: null,
    sseOpen: null,
    uptimeSeconds: null,
  };
  try {
    const res = await fetch(METRICS_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return sample;
    const text = await res.text();
    const gauge = (name) => {
      const match = text.match(new RegExp(`^${name}\\s+(\\d+)`, "m"));
      return match ? Number(match[1]) : null;
    };
    sample.heapUsed = gauge("ophirpay_process_heap_used_bytes");
    sample.heapTotal = gauge("ophirpay_process_heap_total_bytes");
    sample.rss = gauge("ophirpay_process_resident_set_bytes");
    sample.sseOpen = gauge("ophirpay_sse_open_connections");
  } catch {
    // Metrics endpoint unreachable — treat as unknown (skip memory assertions)
  }
  return sample;
}

// ── Main runner ────────────────────────────────────────────────
async function runLoadTest() {
  console.log("┌────────────────────────────────────────────────────────────┐");
  console.log("│        OphirPay — SSE Load Test (100 concurrent)           │");
  console.log("└────────────────────────────────────────────────────────────┘");
  info(`Endpoint:  ${ENDPOINT}`);
  info(`Clients:   ${CONCURRENCY}`);
  info(`Duration:  ${(DURATION_MS / 1000).toFixed(0)}s (heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
  info(`Metrics:   ${METRICS_URL}`);

  // 1. Baseline server memory
  const baseline = await fetchServerMetrics();
  info(`Baseline server memory: heapUsed=${mb(baseline.heapUsed ?? 0)} rss=${mb(baseline.rss ?? 0)}`);

  // 2. Open CONCURRENCY simultaneous connections
  const state = { started: 0, connected: 0, settled: 0 };
  const abortController = new AbortController();
  const clients = Array.from({ length: CONCURRENCY }, (_, i) =>
    openSseClient(i, abortController.signal, state)
  );
  // The resolved client objects (heartbeat counts, connect/close timing).
  const results = Array.from({ length: CONCURRENCY }, () => null);
  // Track when the response stream is fully torn down server-side.
  const readLoops = clients.map(({ run }) => run);

  // 3. Sample server metrics while the test runs
  const samples = [];
  const harnessSamples = [];
  const sampler = (async () => {
    while (!abortController.signal.aborted) {
      const sample = await fetchServerMetrics();
      sample.elapsedMs = Date.now();
      samples.push(sample);
      harnessSamples.push(process.memoryUsage().heapUsed);
      await sleep(SAMPLE_INTERVAL_MS);
    }
  })();
  const harnessBaseline = process.memoryUsage().heapUsed;

  // 4. Let all clients connect (all must be up before we start counting)
  const connectDeadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (state.connected < CONCURRENCY && Date.now() < connectDeadline) {
    await sleep(200);
  }
  if (state.connected < CONCURRENCY) {
    fail(`Only ${state.connected}/${CONCURRENCY} clients connected within ${CONNECT_TIMEOUT_MS}ms`);
    abortController.abort();
    await Promise.allSettled(clients);
    process.exit(1);
  }
  pass(`All ${CONCURRENCY} clients connected (${state.connected})`);

  // 5. Run for the configured duration so each client sees ≥2 heartbeats
  await sleep(DURATION_MS);

  // 6. Disconnect every client and wait for the server to release them
  abortController.abort();
  const settled = await Promise.allSettled(readLoops);
  settled.forEach((s, i) => {
    results[i] = s.status === "fulfilled" ? s.value : null;
  });
  await sampler;
  const harnessPeak = Math.max(harnessBaseline, ...harnessSamples);

  info(`Clients settled: ${state.settled}/${CONCURRENCY} read loops finished cleanly`);
  await sleep(SETTLE_MS);
  const after = await fetchServerMetrics();
  const harnessAfter = process.memoryUsage().heapUsed;

  // 7. Acceptance checks
  const failures = [];
  const healthyClients = results.filter((c) => c !== null);

  // 7a. Heartbeat delivery within the expected interval
  const noHeartbeat = healthyClients.filter((c) => c.heartbeatCount === 0);
  if (noHeartbeat.length > 0) {
    failures.push(`${noHeartbeat.length} client(s) received no heartbeat`);
  }
  const slowHeartbeat = healthyClients.filter(
    (c) => c.firstHeartbeatAt !== null && c.firstHeartbeatAt > HEARTBEAT_INTERVAL_MS + HEARTBEAT_GRACE_MS
  );
  if (slowHeartbeat.length > 0) {
    failures.push(
      `${slowHeartbeat.length} client(s) got their first heartbeat after ${HEARTBEAT_INTERVAL_MS + HEARTBEAT_GRACE_MS}ms`
    );
  }
  const totalHeartbeats = healthyClients.reduce((sum, c) => sum + c.heartbeatCount, 0);
  const minFirst = Math.min(...healthyClients.map((c) => c.firstHeartbeatAt ?? Infinity));
  const maxFirst = Math.max(...healthyClients.map((c) => c.firstHeartbeatAt ?? 0));
  info(
    `Heartbeats: ${totalHeartbeats} delivered (${(totalHeartbeats / CONCURRENCY).toFixed(1)}/client), ` +
      `first-heartbeat range ${minFirst}ms–${maxFirst}ms`
  );

  // 7b. Concurrent connection peak reached 100 on the server side
  const peakOpen = Math.max(...samples.map((s) => s.sseOpen ?? 0), after.sseOpen ?? 0, baseline.sseOpen ?? 0);
  info(`Server observed ${peakOpen} open SSE connection(s) at peak (target ${CONCURRENCY})`);
  if (peakOpen < CONCURRENCY) {
    failures.push(`server never reported ${CONCURRENCY} open SSE connections (peak ${peakOpen})`);
  }

  // 7c. No connection leak: gauge back to baseline after disconnect
  info(`Open SSE connections after disconnect: ${after.sseOpen ?? "unknown"}`);
  if (after.sseOpen !== null && after.sseOpen !== 0) {
    failures.push(`server still reports ${after.sseOpen} open SSE connection(s) after all clients disconnected`);
  }

  // 7d. Server still accepts fresh connections (no fd/handle exhaustion)
  const probes = [];
  for (let i = 0; i < 5; i++) {
    probes.push(
      new Promise((resolve) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
          resolve(false);
        }, CONNECT_TIMEOUT_MS);
        fetch(ENDPOINT, { headers: { Accept: "text/event-stream" }, signal: controller.signal })
          .then(async (res) => {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let okay = false;
            const deadline = Date.now() + CONNECT_TIMEOUT_MS;
            while (Date.now() < deadline) {
              const { value } = await reader.read();
              if (value && decoder.decode(value).includes("connected")) {
                okay = true;
                break;
              }
            }
            controller.abort();
            clearTimeout(timer);
            resolve(okay);
          })
          .catch(() => {
            clearTimeout(timer);
            resolve(false);
          });
      })
    );
  }
  const probeOk = (await Promise.all(probes)).filter(Boolean).length;
  if (probeOk !== 5) {
    failures.push(`only ${probeOk}/5 probe connections succeeded after teardown`);
  } else {
    pass("Fresh connections still work after mass disconnect");
  }

  // 7e. Memory stayed bounded (server-side, when metrics are reachable)
  const heapDeltas = samples.filter((s) => s.heapUsed !== null).map((s) => s.heapUsed - (baseline.heapUsed ?? 0));
  const rssDeltas = samples.filter((s) => s.rss !== null).map((s) => s.rss - (baseline.rss ?? 0));
  const peakHeapDelta = heapDeltas.length ? Math.max(...heapDeltas, 0) : null;
  const peakRssDelta = rssDeltas.length ? Math.max(...rssDeltas, 0) : null;
  if (peakHeapDelta !== null) {
    info(`Server memory growth during run: heapUsed +${mb(peakHeapDelta)}, rss +${mb(peakRssDelta ?? 0)}`);
    if (peakHeapDelta > MAX_SERVER_HEAP_DELTA) {
      failures.push(`server heap grew ${mb(peakHeapDelta)} (> ${mb(MAX_SERVER_HEAP_DELTA)})`);
    }
    if ((peakRssDelta ?? 0) > MAX_SERVER_RSS_DELTA) {
      failures.push(`server RSS grew ${mb(peakRssDelta)} (> ${mb(MAX_SERVER_RSS_DELTA)})`);
    }
    const afterHeapDelta = (after.heapUsed ?? 0) - (baseline.heapUsed ?? 0);
    const afterRssDelta = (after.rss ?? 0) - (baseline.rss ?? 0);
    info(`Server memory after teardown: heapUsed +${mb(afterHeapDelta)}, rss +${mb(afterRssDelta)} vs baseline`);
    if (afterHeapDelta > MAX_SERVER_HEAP_DELTA_AFTER) {
      failures.push(`server heap did not settle after disconnect (${mb(afterHeapDelta)} above baseline)`);
    }
    if (afterRssDelta > MAX_SERVER_RSS_DELTA_AFTER) {
      failures.push(`server RSS did not settle after disconnect (${mb(afterRssDelta)} above baseline)`);
    }
  } else {
    info("Server memory metrics unreachable — skipping server-side memory assertions");
  }

  // 7f. Harness memory bounded (catches leaks in the test client itself)
  const harnessPeakDelta = Math.max(harnessPeak, harnessAfter) - harnessBaseline;
  info(`Harness heap growth: +${mb(harnessPeakDelta)}`);
  if (harnessPeakDelta > MAX_HARNESS_HEAP_DELTA) {
    failures.push(`load-test harness heap grew ${mb(harnessPeakDelta)} (> ${mb(MAX_HARNESS_HEAP_DELTA)})`);
  }

  // 8. Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("                     SSE Load Test Summary");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(` Clients connected     : ${state.connected}/${CONCURRENCY}`);
  console.log(` Heartbeats delivered  : ${totalHeartbeats} (${(totalHeartbeats / CONCURRENCY).toFixed(1)}/client)`);
  console.log(` Peak open connections : ${peakOpen}`);
  console.log(` Open after teardown   : ${after.sseOpen ?? "unknown"}`);
  console.log(` Server heap growth    : +${mb(peakHeapDelta ?? 0)} during, +${mb(Math.max(0, (after.heapUsed ?? 0) - (baseline.heapUsed ?? 0)))} after`);
  console.log("───────────────────────────────────────────────────────────");

  if (failures.length > 0) {
    for (const f of failures) fail(f);
    console.log(`❌ Load test FAILED (${failures.length} check(s) failed)`);
    process.exit(1);
  }
  pass("All acceptance checks passed — no connection leak, memory bounded, heartbeats on time");
  process.exit(0);
}

runLoadTest().catch((err) => {
  console.error(`\n❌ Load test crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});