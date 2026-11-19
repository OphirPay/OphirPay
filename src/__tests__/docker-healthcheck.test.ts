// SPDX-License-Identifier: MIT

/**
 * Issue #1424 — Docker container healthcheck instruction with deep dependency verification.
 *
 * Validates:
 * 1. scripts/healthcheck.js behavior against simulated HTTP servers (success on 200, failure on 5xx/connection errors, deep probe mode).
 * 2. Dockerfile HEALTHCHECK configuration and asset copying.
 * 3. docker-compose.yml healthcheck directive parameters.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { load } from "js-yaml";

const repoRoot = process.cwd();
const healthcheckScriptPath = join(repoRoot, "scripts", "healthcheck.js");

function runHealthcheck(
  args: string[] = [],
  env: Record<string, string | undefined> = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [healthcheckScriptPath, ...args], {
      env: { ...process.env, ...env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("Docker Container Healthcheck (issue #1424)", () => {
  describe("scripts/healthcheck.js script properties", () => {
    it("exists and is less than 2 MB in file size", () => {
      const stats = statSync(healthcheckScriptPath);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.size).toBeLessThan(2 * 1024 * 1024); // < 2 MB requirement
    });
  });

  describe("Healthcheck script execution", () => {
    it("reports healthy (exit 0) when /api/health/live returns HTTP 200", async () => {
      let server: Server;
      const port = await new Promise<number>((resolve) => {
        server = createServer((req, res) => {
          if (req.url === "/api/health/live") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", probe: "liveness" }));
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });

      try {
        const result = await runHealthcheck([], {
          PORT: String(port),
          HEALTHCHECK_HOST: "127.0.0.1",
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Healthy (/api/health/live): HTTP 200");
      } finally {
        server!.close();
      }
    });

    it("reports unhealthy (exit 1) when endpoint returns HTTP 500 error", async () => {
      let server: Server;
      const port = await new Promise<number>((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });

      try {
        const result = await runHealthcheck([], {
          PORT: String(port),
          HEALTHCHECK_HOST: "127.0.0.1",
        });
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("Unhealthy (/api/health/live): HTTP 500");
      } finally {
        server!.close();
      }
    });

    it("supports --deep flag for deep dependency verification against /api/health", async () => {
      let server: Server;
      const port = await new Promise<number>((resolve) => {
        server = createServer((req, res) => {
          if (req.url === "/api/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", checks: { database: "ok" } }));
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });

      try {
        const result = await runHealthcheck(["--deep"], {
          PORT: String(port),
          HEALTHCHECK_HOST: "127.0.0.1",
        });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("Healthy (/api/health): HTTP 200");
      } finally {
        server!.close();
      }
    });

    it("fails cleanly when target server is unreachable / connection refused", async () => {
      // Port 59999 where nothing is listening
      const result = await runHealthcheck([], {
        PORT: "59999",
        HEALTHCHECK_HOST: "127.0.0.1",
        HEALTHCHECK_TIMEOUT_MS: "1000",
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Healthcheck error");
    });
  });

  describe("Dockerfile configuration", () => {
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");

    it("bundles scripts/healthcheck.js into the runner stage", () => {
      expect(dockerfile).toMatch(/COPY\s+.*scripts\/healthcheck\.js\s+\.\/scripts\/healthcheck\.js/);
    });

    it("declares HEALTHCHECK instruction with configured parameters", () => {
      expect(dockerfile).toContain("HEALTHCHECK");
      expect(dockerfile).toMatch(/--interval=30s/);
      expect(dockerfile).toMatch(/--timeout=5s/);
      expect(dockerfile).toMatch(/--start-period=15s/);
      expect(dockerfile).toMatch(/--retries=3/);
      expect(dockerfile).toMatch(/CMD\s+\["node",\s*"scripts\/healthcheck\.js",\s*"\/api\/health\/live"\]/);
    });
  });

  describe("docker-compose.yml configuration", () => {
    const compose = load(
      readFileSync(join(repoRoot, "docker-compose.yml"), "utf8")
    ) as { services: { app: { healthcheck: { test: string[]; interval: string; timeout: string; start_period: string; retries: number } } } };

    it("defines matching healthcheck for the app container", () => {
      const hc = compose.services.app.healthcheck;
      expect(hc).toBeDefined();
      expect(hc.test).toEqual(["CMD", "node", "scripts/healthcheck.js", "/api/health/live"]);
      expect(hc.interval).toBe("30s");
      expect(hc.timeout).toBe("5s");
      expect(hc.start_period).toBe("20s");
      expect(hc.retries).toBe(3);
    });
  });
});
