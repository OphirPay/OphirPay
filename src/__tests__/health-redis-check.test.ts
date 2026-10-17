// SPDX-License-Identifier: MIT
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/contracts", () => ({
  OPHIRPAY_CONTRACT_ID: "CAQQYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
}));

import prisma from "@/lib/prisma";
import { GET } from "@/app/api/health/route";

describe("GET /api/health Redis connectivity check (#1338)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;
    delete process.env.REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ 1: 1 }]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it("reports services.redis.status='ok' for a working TCP redis:// URL via RESP PING", async () => {
    const receivedCommands: string[] = [];
    const server = net.createServer((socket) => {
      socket.on("data", (data) => {
        const text = data.toString("utf8");
        receivedCommands.push(text);
        if (text.includes("PING")) {
          socket.write("+PONG\r\n");
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as net.AddressInfo;

    try {
      process.env.REDIS_URL = `redis://default:s3cr3t@127.0.0.1:${address.port}/0`;

      const res = await GET(new Request("http://localhost/api/health"));
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.services.redis.status).toBe("ok");
      expect(typeof body.data.services.redis.latencyMs).toBe("number");
      expect(body.data.status).toBe("ok");
      expect(receivedCommands.join("")).toContain("AUTH");
      expect(receivedCommands.join("")).toContain("PING");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports services.redis.status='ok' for an Upstash https:// URL with Authorization: Bearer REDIS_TOKEN", async () => {
    process.env.REDIS_URL = "https://eu1-merry-anchovy-12345.upstash.io";
    process.env.REDIS_TOKEN = "upstash-secret-token-1338";

    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("ok");
    expect(body.data.status).toBe("ok");

    const upstashCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("upstash.io/ping"),
    );
    expect(upstashCall).toBeDefined();
    expect(upstashCall![0]).toBe(
      "https://eu1-merry-anchovy-12345.upstash.io/ping",
    );
    expect(
      (upstashCall![1] as { headers?: Record<string, string> })?.headers
        ?.Authorization,
    ).toBe("Bearer upstash-secret-token-1338");
  });

  it("reports services.redis.status='error' and overall status='degraded' when Redis is unreachable", async () => {
    // Allocate and immediately close a local port so TCP connection is refused
    const probeServer = net.createServer();
    await new Promise<void>((resolve) =>
      probeServer.listen(0, "127.0.0.1", resolve),
    );
    const closedPort = (probeServer.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => probeServer.close(() => resolve()));

    process.env.REDIS_URL = `redis://127.0.0.1:${closedPort}`;

    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.services.redis.status).toBe("error");
    expect(body.data.status).toBe("degraded");
  });
});
