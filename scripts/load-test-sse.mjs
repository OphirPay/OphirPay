#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * SSE endpoint load test — opens N concurrent Server-Sent Events connections,
 * keeps them open for a configurable duration, and reports throughput/latency.
 *
 * Usage:
 *   node scripts/load-test-sse.mjs [url] [clients] [durationSeconds]
 *
 * Environment variables:
 *   SSE_URL            target endpoint (default: http://localhost:3000/api/events)
 *   CLIENTS            concurrent connections (default: 100)
 *   DURATION_SECONDS   test duration (default: 30)
 *
 * Example:
 *   CLIENTS=50 DURATION_SECONDS=10 node scripts/load-test-sse.mjs
 */

import http from "http";
import https from "https";

const url = new URL(
  process.argv[2] ||
    process.env.SSE_URL ||
    "http://localhost:3000/api/events"
);
const clients = parseInt(process.argv[3] || process.env.CLIENTS || "100", 10);
const durationMs =
  parseInt(
    process.argv[4] || process.env.DURATION_SECONDS || "30",
    10
  ) * 1000;

const stats = {
  attempted: 0,
  connected: 0,
  failed: 0,
  events: 0,
  heartbeats: 0,
  payments: 0,
  bytes: 0,
  latencies: [],
};

const startTime = Date.now();
const connections = [];

function logStats() {
  const elapsedSec = (Date.now() - startTime) / 1000;
  console.log("\n--- SSE load test results ---");
  console.log(`Target:            ${url.href}`);
  console.log(`Clients requested: ${clients}`);
  console.log(`Connected:         ${stats.connected}`);
  console.log(`Failed:            ${stats.failed}`);
  console.log(`Duration (s):      ${elapsedSec.toFixed(1)}`);
  console.log(`Total events:      ${stats.events}`);
  console.log(`  heartbeats:      ${stats.heartbeats}`);
  console.log(`  payment:created: ${stats.payments}`);
  console.log(`Events/sec:        ${(stats.events / elapsedSec).toFixed(1)}`);
  console.log(`Throughput (KB/s): ${((stats.bytes / 1024) / elapsedSec).toFixed(1)}`);
  if (stats.latencies.length > 0) {
    const sorted = [...stats.latencies].sort((a, b) => a - b);
    const avg = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    console.log(`Latency (ms) avg/p50/p95/p99: ${avg.toFixed(0)}/${p50}/${p95}/${p99}`);
  }
}

function connectClient(index) {
  stats.attempted++;
  const connectStart = Date.now();
  const request = (url.protocol === "https:" ? https : http).request(
    url,
    { headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" } },
    (res) => {
      if (res.statusCode !== 200) {
        stats.failed++;
        console.error(`Client ${index}: HTTP ${res.statusCode}`);
        res.resume();
        return;
      }
      stats.connected++;
      stats.latencies.push(Date.now() - connectStart);

      let buffer = "";
      let eventName = "";
      let dataLines = [];

      res.on("data", (chunk) => {
        stats.bytes += chunk.length;
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep partial line for next chunk

        for (const line of lines) {
          if (line === "") {
            // dispatch event
            if (eventName && dataLines.length) {
              stats.events++;
              if (eventName === "heartbeat") stats.heartbeats++;
              if (eventName === "payment:created") stats.payments++;
            }
            eventName = "";
            dataLines = [];
          } else if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
          // other fields (id, retry) ignored for load-test metrics
        }
      });

      res.on("error", (err) => {
        stats.failed++;
        console.error(`Client ${index} response error: ${err.message}`);
      });

      res.on("end", () => {
        // Connection closed by server before test end — count as failure if not intentional.
        if (Date.now() - startTime < durationMs - 500) {
          stats.failed++;
        }
      });
    }
  );

  request.on("error", (err) => {
    stats.failed++;
    console.error(`Client ${index} request error: ${err.message}`);
  });

  request.end();
  connections.push(request);
}

function run() {
  console.log(
    `Starting SSE load test: ${clients} clients for ${durationMs / 1000}s against ${url.href}`
  );

  // Stagger connections over 1 second to avoid thundering herd.
  for (let i = 0; i < clients; i++) {
    setTimeout(() => connectClient(i), (i / clients) * 1000);
  }

  setTimeout(() => {
    for (const req of connections) {
      try {
        req.destroy();
      } catch {}
    }
    logStats();
  }, durationMs);
}

run();
