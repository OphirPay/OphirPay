// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();

function runHealthcheck(port: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/healthcheck.js"], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(port) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("Docker container healthcheck probe (#1424)", () => {
  it("Dockerfile specifies HEALTHCHECK instruction invoking scripts/healthcheck.js with tuned parameters", () => {
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "COPY --chown=node:node scripts/healthcheck.js ./scripts/healthcheck.js",
    );
    expect(dockerfile).toMatch(
      /HEALTHCHECK\s+--interval=30s\s+--timeout=5s\s+--start-period=15s\s+--retries=3\s+CMD\s+\["node",\s*"scripts\/healthcheck\.js"\]/,
    );
  });

  it("docker-compose.yml specifies app service healthcheck with scripts/healthcheck.js and 15s start_period", () => {
    const compose = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");

    expect(compose).toMatch(
      /test:\s*\["CMD",\s*"node",\s*"scripts\/healthcheck\.js"\]/,
    );
    expect(compose).toMatch(/interval:\s*30s/);
    expect(compose).toMatch(/timeout:\s*5s/);
    expect(compose).toMatch(/start_period:\s*15s/);
    expect(compose).toMatch(/retries:\s*3/);
  });

  it("scripts/healthcheck.js exits 0 when /api/health/live responds 200", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/health/live") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const result = await runHealthcheck(port);
      expect(result.code).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("scripts/healthcheck.js exits 1 when /api/health/live responds 503", async () => {
    const server = createServer((req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error" }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const result = await runHealthcheck(port);
      expect(result.code).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("scripts/healthcheck.js exits 1 when port is unreachable", async () => {
    const result = await runHealthcheck(59999);
    expect(result.code).toBe(1);
  });
});
