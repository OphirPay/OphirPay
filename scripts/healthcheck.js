// SPDX-License-Identifier: MIT
/**
 * Container healthcheck script (Issues #738, #1424).
 *
 * Bundled into the standalone Docker runner image at `/app/scripts/healthcheck.js`
 * and invoked by `HEALTHCHECK` in `Dockerfile` and `docker-compose.yml`.
 *
 * Supports:
 *   • Lightweight liveness checks (`/api/health/live`) for container restart decisions
 *   • Deep dependency readiness checks (`/api/health` or `--deep` / `HEALTHCHECK_DEEP=true`)
 *     that verify database and upstream service health in the JSON payload.
 */

const http = require("http");

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Parse CLI arguments and environment variables into healthcheck options.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
function parseHealthcheckOptions(argv = process.argv.slice(2), env = process.env) {
  let pathArg = null;
  let deep = env.HEALTHCHECK_DEEP === "true" || env.HEALTHCHECK_DEEP === "1";

  for (const arg of argv) {
    if (arg === "--deep") {
      deep = true;
    } else if (arg.startsWith("/")) {
      pathArg = arg;
    }
  }

  const host = env.HEALTHCHECK_HOST || "127.0.0.1";
  const port = Number(env.PORT) || 3000;
  const timeoutMs = Number(env.HEALTHCHECK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const endpointPath = pathArg || env.HEALTHCHECK_PATH || (deep ? "/api/health" : "/api/health/live");

  // Probing `/api/health` directly implies deep dependency verification unless disabled.
  if (endpointPath === "/api/health" && env.HEALTHCHECK_DEEP !== "false") {
    deep = true;
  }

  return {
    host,
    port,
    path: endpointPath,
    timeoutMs,
    deep,
  };
}

/**
 * Validate the parsed JSON health response body.
 *
 * @param {unknown} payload
 * @param {{ deep?: boolean }} options
 * @returns {{ healthy: boolean; reason: string }}
 */
function verifyHealthPayload(payload, options = {}) {
  const deep = Boolean(options.deep);

  if (!payload || typeof payload !== "object") {
    return { healthy: false, reason: "Invalid or empty JSON payload" };
  }

  const root = /** @type {Record<string, any>} */ (payload);
  if (root.success === false) {
    return { healthy: false, reason: "Health response reported success=false" };
  }

  const data = root.data && typeof root.data === "object" ? root.data : root;
  const status = data.status;

  if (status !== "ok" && status !== "degraded") {
    return {
      healthy: false,
      reason: `Unhealthy status reported: ${String(status ?? "unknown")}`,
    };
  }

  if (deep && data.services && typeof data.services === "object") {
    const db = data.services.database;
    if (db && typeof db === "object" && db.status === "down") {
      return {
        healthy: false,
        reason: "Critical dependency database is down",
      };
    }

    const rpc = data.services.sorobanRpc;
    const horizon = data.services.horizon;
    if (
      rpc &&
      typeof rpc === "object" &&
      rpc.status === "down" &&
      horizon &&
      typeof horizon === "object" &&
      horizon.status === "down"
    ) {
      return {
        healthy: false,
        reason: "Both Soroban RPC and Horizon dependencies are down",
      };
    }
  }

  return { healthy: true, reason: "ok" };
}

/**
 * Execute an HTTP health probe against the local container server.
 *
 * @param {{
 *   host?: string;
 *   port?: number;
 *   path?: string;
 *   timeoutMs?: number;
 *   deep?: boolean;
 *   httpGet?: typeof http.get;
 * }} [opts]
 * @returns {Promise<{ healthy: boolean; statusCode: number; reason: string }>}
 */
function runHealthcheck(opts = {}) {
  const resolved = {
    ...parseHealthcheckOptions(),
    ...opts,
  };
  const httpGet = resolved.httpGet || http.get;
  const url = `http://${resolved.host}:${resolved.port}${resolved.path}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const req = httpGet(url, { timeout: resolved.timeoutMs }, (res) => {
      const statusCode = res.statusCode || 0;
      let rawBody = "";

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        rawBody += chunk;
      });

      res.on("end", () => {
        if (statusCode < 200 || statusCode >= 300) {
          finish({
            healthy: false,
            statusCode,
            reason: `HTTP ${statusCode}`,
          });
          return;
        }

        if (!rawBody.trim()) {
          if (resolved.deep) {
            finish({
              healthy: false,
              statusCode,
              reason: "Empty response body during deep healthcheck",
            });
          } else {
            finish({ healthy: true, statusCode, reason: "ok" });
          }
          return;
        }

        try {
          const parsed = JSON.parse(rawBody);
          const verification = verifyHealthPayload(parsed, { deep: resolved.deep });
          finish({
            healthy: verification.healthy,
            statusCode,
            reason: verification.reason,
          });
        } catch {
          if (resolved.deep) {
            finish({
              healthy: false,
              statusCode,
              reason: "Malformed JSON response",
            });
          } else {
            finish({ healthy: true, statusCode, reason: "ok" });
          }
        }
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Healthcheck request timed out"));
      finish({
        healthy: false,
        statusCode: 0,
        reason: "timeout",
      });
    });

    req.on("error", (err) => {
      finish({
        healthy: false,
        statusCode: 0,
        reason: err && err.message ? err.message : "request error",
      });
    });
  });
}

if (require.main === module) {
  const options = parseHealthcheckOptions();
  runHealthcheck(options)
    .then((result) => {
      process.exit(result.healthy ? 0 : 1);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  parseHealthcheckOptions,
  verifyHealthPayload,
  runHealthcheck,
};
