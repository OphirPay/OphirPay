import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "http";

vi.mock("@/lib/webhook-url-guard", () => ({
  isSafeWebhookUrlAtDelivery: vi.fn(async () => true),
}));

import { deliverWebhook } from "@/lib/webhook-deliver";

describe("webhook delivery retry flow", () => {
  let server: http.Server;
  let port = 0;
  const bodies: string[] = [];
  let attempts = 0;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        bodies.push(body);
        attempts += 1;
        response.statusCode = attempts === 1 ? 500 : 204;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("delivers a signed event after a failed first attempt", async () => {
    const delivered = await deliverWebhook(
      `http://127.0.0.1:${port}/webhook`,
      "e2e-secret",
      { event: "payment.created", timestamp: new Date().toISOString(), data: { id: "p-1" } },
      2,
    );

    expect(delivered).toBe(true);
    expect(attempts).toBe(2);
    expect(JSON.parse(bodies[1]).event).toBe("payment.created");
    expect(JSON.parse(bodies[1]).signature).toMatch(/^[a-f0-9]{64}$/);
  });
});
