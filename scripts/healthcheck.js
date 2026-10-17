#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * Docker container healthcheck probe (issues #738, #1424).
 * Probes the target health endpoint using native fetch.
 * Returns 0 on HTTP 2xx, 1 on any failure, HTTP error status, or timeout.
 */

const port = process.env.PORT || "3000";
const host = process.env.HEALTHCHECK_HOST || "127.0.0.1";
const path = process.argv[2] || process.env.HEALTHCHECK_PATH || "/api/health/live";
const timeoutMs = parseInt(process.env.HEALTHCHECK_TIMEOUT_MS || "4500", 10);

const targetUrl = `http://${host}:${port}${path.startsWith("/") ? path : "/" + path}`;

const controller = new AbortController();
const timer = setTimeout(() => {
  controller.abort();
}, timeoutMs);

fetch(targetUrl, { signal: controller.signal })
  .then((response) => {
    clearTimeout(timer);
    if (response.ok) {
      process.exit(0);
    } else {
      process.stderr.write(`Healthcheck failed: ${targetUrl} returned HTTP ${response.status}\n`);
      process.exit(1);
    }
  })
  .catch((err) => {
    clearTimeout(timer);
    const msg = err.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : err.message;
    process.stderr.write(`Healthcheck error: ${targetUrl} (${msg})\n`);
    process.exit(1);
  });
