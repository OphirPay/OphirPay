// SPDX-License-Identifier: MIT
import fs from "node:fs";

/**
 * E2E server readiness checker (#1324).
 *
 * Status-code contract of `/api/health`:
 * - HTTP 200: `healthy` OR `degraded` (database is reachable; optional Stellar
 *   or Redis dependencies may be degraded).
 * - HTTP 503: `unhealthy` — returned ONLY when the database check fails.
 *
 * Previously, the readiness loop treated HTTP 503 as ready, masking a dead
 * database and causing downstream E2E tests to fail with confusing errors.
 *
 * This helper:
 * 1. Polls `/api/health/live` until the Node.js process responds with HTTP 200.
 * 2. Polls `/api/health` and requires HTTP 200 (rejecting HTTP 503).
 * 3. On timeout or HTTP 503 failure, dumps the last `/api/health` JSON body
 *    and optional server log file contents before throwing.
 */
export async function waitForE2eServerReady({
  baseUrl = process.env.BASE_URL || "http://localhost:3000",
  maxAttempts = 30,
  intervalMs = 1000,
  serverLogPath = process.env.E2E_SERVER_LOG || "",
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const liveUrl = `${normalizedBase}/api/health/live`;
  const healthUrl = `${normalizedBase}/api/health`;

  let liveReady = false;
  let lastStatus = 0;
  let lastHealthBody = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!liveReady) {
        const liveRes = await fetchImpl(liveUrl);
        if (liveRes.status === 200) {
          liveReady = true;
        } else {
          lastStatus = liveRes.status;
        }
      }

      if (liveReady) {
        const healthRes = await fetchImpl(healthUrl);
        lastStatus = healthRes.status;
        lastHealthBody = await healthRes.text().catch(() => "");

        // HTTP 200 covers both "healthy" and "degraded" (when DB is up).
        // HTTP 503 means the database check failed and MUST NOT be treated as ready.
        if (healthRes.status === 200) {
          return {
            ok: true,
            attempts: attempt,
            status: healthRes.status,
            body: lastHealthBody,
          };
        }
      }
    } catch (err) {
      lastHealthBody = err instanceof Error ? err.message : String(err);
    }

    if (attempt < maxAttempts && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  let serverLogDump = "";
  if (serverLogPath && fs.existsSync(serverLogPath)) {
    try {
      serverLogDump = fs.readFileSync(serverLogPath, "utf8");
    } catch {
      serverLogDump = "<unable to read server log>";
    }
  }

  logger.error(
    `[E2E Readiness Failed] ${healthUrl} did not return HTTP 200 after ${maxAttempts} attempts (last status: ${lastStatus}).`
  );
  if (lastHealthBody) {
    logger.error(`[E2E /api/health body]: ${lastHealthBody}`);
  }
  if (serverLogDump) {
    logger.error(`[E2E server log]:\n${serverLogDump}`);
  }

  throw new Error(
    `E2E server readiness check failed (last HTTP status ${lastStatus}). Health body: ${
      lastHealthBody || "<empty>"
    }`
  );
}
