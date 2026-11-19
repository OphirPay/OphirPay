#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Docker container healthcheck probe script (issue #1424).
 *
 * Lightweight, zero-dependency probe executing within the distroless/runner
 * container stage. Probes either the process liveness endpoint (/api/health/live)
 * or optionally performs deep dependency verification (/api/health).
 *
 * Usage:
 *   node scripts/healthcheck.js          # Liveness probe (default)
 *   node scripts/healthcheck.js --deep   # Deep dependency verification
 */

const http = require("node:http");

const isDeep = process.argv.includes("--deep");
const host = process.env.HEALTHCHECK_HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const endpointArg = process.argv.slice(2).find((arg) => arg.startsWith("/"));
const defaultEndpoint = endpointArg || (isDeep ? "/api/health" : "/api/health/live");
const path = process.env.HEALTHCHECK_ENDPOINT || defaultEndpoint;
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 4000);

const options = {
  host,
  port,
  path,
  method: "GET",
  timeout: timeoutMs,
  headers: {
    "User-Agent": "OphirPay-Docker-Healthcheck/1.0",
    Accept: "application/json",
  },
};

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    if (res.statusCode === 200) {
      process.stdout.write(`Healthy (${path}): HTTP ${res.statusCode}\n`);
      process.exit(0);
    } else {
      process.stderr.write(
        `Unhealthy (${path}): HTTP ${res.statusCode} — ${data.slice(0, 200)}\n`
      );
      process.exit(1);
    }
  });
});

req.on("timeout", () => {
  req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
});

req.on("error", (err) => {
  process.stderr.write(`Healthcheck error (${path}): ${err.message}\n`);
  process.exit(1);
});

req.end();
