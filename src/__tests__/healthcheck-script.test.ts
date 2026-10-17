// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), "scripts", "healthcheck.js");

describe("Container healthcheck script (#1424)", () => {
  let testServer: Server;
  let testPort: number;
  let responseStatusCode = 200;

  beforeAll(async () => {
    testServer = createServer((_req, res) => {
      res.writeHead(responseStatusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: responseStatusCode === 200 ? "ok" : "error" }));
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, "127.0.0.1", () => {
        const addr = testServer.address();
        testPort = typeof addr === "object" && addr ? addr.port : 3999;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
  });

  it("exists and has executable node hashbang", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const content = readFileSync(scriptPath, "utf8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("exits with 0 when target endpoint returns 200 OK", async () => {
    responseStatusCode = 200;
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "/test"], {
      env: { ...process.env, PORT: String(testPort) },
    });
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it("exits with 1 when target endpoint returns 500 error", async () => {
    responseStatusCode = 500;
    try {
      await execFileAsync(process.execPath, [scriptPath, "/test"], {
        env: { ...process.env, PORT: String(testPort) },
      });
      expect.unreachable("script should have exited with code 1");
    } catch (err: unknown) {
      const error = err as { code: number; stderr: string };
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("500");
    }
  });

  it("exits with 1 when target endpoint returns 503 service unavailable", async () => {
    responseStatusCode = 503;
    try {
      await execFileAsync(process.execPath, [scriptPath, "/test"], {
        env: { ...process.env, PORT: String(testPort) },
      });
      expect.unreachable("script should have exited with code 1");
    } catch (err: unknown) {
      const error = err as { code: number; stderr: string };
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("503");
    }
  });

  it("exits with 1 when target port is unreachable", async () => {
    try {
      // Connect to an unused high port
      await execFileAsync(process.execPath, [scriptPath, "/test"], {
        env: { ...process.env, PORT: "49999" },
      });
      expect.unreachable("script should have exited with code 1");
    } catch (err: unknown) {
      const error = err as { code: number; stderr: string };
      expect(error.code).toBe(1);
      expect(error.stderr).toContain("Healthcheck error");
    }
  });
});
