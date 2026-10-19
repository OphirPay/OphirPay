#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Container healthcheck probe for Docker, Docker Compose, and ECS.
 * Probes the liveness endpoint (/api/health/live) to determine if the Next.js
 * Node process is alive and responsive without executing expensive dependency checks.
 */

const http = require("node:http");

const port = process.env.PORT || 3000;
const host = "127.0.0.1";
const path = "/api/health/live";
const timeoutMs = 4500;

const options = {
  host,
  port,
  path,
  method: "GET",
  timeout: timeoutMs,
  headers: {
    "User-Agent": "Docker-Healthcheck/1.0",
  },
};

const req = http.request(options, (res) => {
  const isHealthy = Boolean(
    res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
  );
  if (isHealthy) {
    process.exit(0);
  } else {
    process.stderr.write(`Healthcheck failed: HTTP ${res.statusCode}\n`);
    process.exit(1);
  }
});

req.on("timeout", () => {
  req.destroy(new Error(`Healthcheck timed out after ${timeoutMs}ms`));
});

req.on("error", (err) => {
  process.stderr.write(`Healthcheck connection error: ${err.message}\n`);
  process.exit(1);
});

req.end();
